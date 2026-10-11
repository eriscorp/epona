import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { dialogDefaultPath, pickerStartPath, withPickerStart } from './pickerStart.js'

const docs = join('/home/me/Documents')
const onDisk = new Set([
  join('/'),
  join('/client'),
  join('/client', 'Darkages.exe'),
  join('/home/me'),
  docs
])
const exists = async (p) => onDisk.has(p)

describe('pickerStartPath', () => {
  it('takes the first candidate that exists', async () => {
    expect(await pickerStartPath([join('/client'), join('/home/me')], exists)).toBe(join('/client'))
  })

  it('skips a stale setting, an empty string and a missing value', async () => {
    expect(await pickerStartPath([null, undefined, '', join('/moved'), docs], exists)).toBe(docs)
  })

  it('returns undefined when nothing exists, so the dialog gets no defaultPath', async () => {
    expect(await pickerStartPath([join('/nope')], exists)).toBeUndefined()
  })
})

describe('dialogDefaultPath', () => {
  const start = async () => docs

  it('uses the start folder when the renderer names nothing', async () => {
    expect(await dialogDefaultPath(undefined, start, 'open', exists)).toBe(docs)
    expect(await dialogDefaultPath('', start, 'save', exists)).toBe(docs)
  })

  it('ignores a value that is not a string', async () => {
    expect(await dialogDefaultPath(42, start, 'open', exists)).toBe(docs)
  })

  it('keeps an open path that exists, and does not look for a start folder', async () => {
    const noStart = vi.fn(start)
    expect(await dialogDefaultPath(join('/client'), noStart, 'open', exists)).toBe(join('/client'))
    expect(noStart).not.toHaveBeenCalled()
  })

  it('keeps a save path whose folder exists, although the file is new', async () => {
    const path = join('/client', 'server.log')
    expect(await dialogDefaultPath(path, start, 'save', exists)).toBe(path)
  })

  it('puts a bare save name in the start folder, not in Downloads', async () => {
    expect(await dialogDefaultPath('server.log', start, 'save', exists)).toBe(
      join(docs, 'server.log')
    )
  })

  it('moves a stale save path to the start folder and keeps its name', async () => {
    const stale = join('/moved', 'server.log')
    expect(await dialogDefaultPath(stale, start, 'save', exists)).toBe(join(docs, 'server.log'))
  })

  it('opens in the folder of a file that is gone', async () => {
    const gone = join('/client', 'Darkages-old.exe')
    expect(await dialogDefaultPath(gone, start, 'open', exists)).toBe(join('/client'))
  })

  it('opens at the start folder, with no name, when the path and its folder are gone', async () => {
    expect(await dialogDefaultPath(join('/moved', 'client'), start, 'open', exists)).toBe(docs)
  })

  it('never hands an open dialog a bare name', async () => {
    expect(await dialogDefaultPath('client', start, 'open', exists)).toBe(docs)
  })

  it('passes the request through when there is no start folder', async () => {
    const none = async () => undefined
    expect(await dialogDefaultPath('server.log', none, 'save', exists)).toBe('server.log')
    expect(await dialogDefaultPath(undefined, none, 'open', exists)).toBeUndefined()
    expect(await dialogDefaultPath('client', none, 'open', exists)).toBeUndefined()
  })
})

describe('withPickerStart', () => {
  function setup() {
    const inner = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [] })),
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: undefined }))
    }
    const dialog = withPickerStart(inner, { fallbacks: () => [docs, join('/home/me')], exists })
    const lastOpen = () => inner.showOpenDialog.mock.calls.at(-1)
    const lastSave = () => inner.showSaveDialog.mock.calls.at(-1)
    return { inner, dialog, lastOpen, lastSave }
  }

  it('opens in Documents when the renderer names nothing', async () => {
    const { dialog, lastOpen } = setup()
    await dialog.showOpenDialog('win', { properties: ['openDirectory'] })
    expect(lastOpen()[1]).toMatchObject({ defaultPath: docs })
  })

  it('passes the window through to the inner dialog', async () => {
    const { dialog, lastOpen, lastSave } = setup()
    await dialog.showOpenDialog('win', { properties: ['openFile'] })
    await dialog.showSaveDialog('win', { defaultPath: 'server.log' })
    expect(lastOpen()[0]).toBe('win')
    expect(lastSave()[0]).toBe('win')
  })

  it('opens the next dialog in the folder of the last pick', async () => {
    const { inner, dialog, lastOpen, lastSave } = setup()
    inner.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [join('/client', 'Darkages.exe')]
    })
    await dialog.showOpenDialog('win', { properties: ['openFile'] })
    await dialog.showSaveDialog('win', { defaultPath: 'server.log' })
    expect(lastSave()[1]).toMatchObject({ defaultPath: join('/client', 'server.log') })

    inner.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [join('/home/me')] })
    await dialog.showOpenDialog('win', { properties: ['openDirectory'] })
    await dialog.showOpenDialog('win', { properties: ['openFile'] })
    expect(lastOpen()[1]).toMatchObject({ defaultPath: join('/home/me') })
  })

  it('keeps the other options and returns the inner result', async () => {
    const { inner, dialog, lastOpen } = setup()
    const filters = [{ name: 'Executables', extensions: ['exe'] }]
    inner.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await dialog.showOpenDialog('win', { properties: ['openFile'], filters })).toEqual({
      canceled: true,
      filePaths: []
    })
    expect(lastOpen()[1]).toMatchObject({ properties: ['openFile'], filters })
  })
})

describe('every picker in main goes through withPickerStart', () => {
  it('finds no raw dialog.showOpenDialog or showSaveDialog outside pickerStart.js', async () => {
    // A raw call skips the start folder, and since Electron 43 it opens in
    // Downloads. pickerStart.js itself calls the dialog it wraps.
    const { readdirSync, readFileSync } = await import('fs')
    const dir = join(import.meta.dirname)
    const raw = /(?<![\w.])dialog\.show(Open|Save)Dialog\(/
    const offenders = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'pickerStart.js')
      .filter((f) => !f.endsWith('electronDouble.js'))
      .filter((f) => raw.test(readFileSync(join(dir, f), 'utf-8')))
    expect(offenders).toEqual([])
  })
})
