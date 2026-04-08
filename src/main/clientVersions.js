import { createHash } from 'crypto'
import { createReadStream } from 'fs'

// Port of ClientVersion.cs — all addresses as BigInt
const VERSIONS = [
  {
    name: 'US Dark Ages 7.37',
    versionCode: 737,
    hash: '36f4689b09a4a91c74555b3c3603b196',
    hostnamePatchAddress: 0x4341fan,
    skipHostnamePatchAddress: null,
    portPatchAddress: 0x434224n,
    skipIntroPatchAddress: 0x42f48fn,
    multipleInstancesPatchAddress: 0x5911aen,
    hideWallsPatchAddress: 0x624bc4n
  },
  {
    name: 'US Dark Ages 7.39',
    versionCode: 739,
    hash: 'ca31b8165ea7409d285d81616d8ca4f2',
    hostnamePatchAddress: 0x4341fan,
    skipHostnamePatchAddress: null,
    portPatchAddress: 0x434224n,
    skipIntroPatchAddress: 0x42f48fn,
    multipleInstancesPatchAddress: 0x5911aen,
    hideWallsPatchAddress: 0x624bc4n
  },
  {
    name: 'US Dark Ages 7.40',
    versionCode: 740,
    hash: '9dc6fb13d0470331bf5ba230343fce42',
    hostnamePatchAddress: 0x4341fan,
    skipHostnamePatchAddress: null,
    portPatchAddress: 0x434224n,
    skipIntroPatchAddress: 0x42f48fn,
    multipleInstancesPatchAddress: 0x5912aen,
    hideWallsPatchAddress: 0x624cc4n
  },
  {
    name: 'US Dark Ages 7.41',
    versionCode: 741,
    hash: '3244dc0e68cd26f4fb1626da3673fda8',
    hostnamePatchAddress: 0x4333c2n,
    skipHostnamePatchAddress: 0x433391n,
    portPatchAddress: 0x4333e4n,
    skipIntroPatchAddress: 0x42e61fn,
    multipleInstancesPatchAddress: 0x57a7cen,
    hideWallsPatchAddress: 0x5fd874n
  }
]

export function listVersions() {
  return VERSIONS.map(({ name, versionCode, hash }) => ({ name, versionCode, hash }))
}

function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

export async function detectVersion(exePath) {
  try {
    const hash = await md5File(exePath)
    const version = VERSIONS.find((v) => v.hash === hash)
    return version ? { found: true, versionCode: version.versionCode, name: version.name } : { found: false }
  } catch {
    return { found: false }
  }
}

export function getVersion(versionCode) {
  return VERSIONS.find((v) => v.versionCode === versionCode) ?? null
}
