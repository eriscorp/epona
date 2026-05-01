// electron-builder beforeBuild override for mac/linux builds. The default
// beforeBuild in electron-builder.yml runs `@electron/rebuild -f -w da-win32`,
// which only makes sense for Windows packaging — da-win32's binding.gyp is
// gated to OS=='win'. Pointing --config.beforeBuild at this file via the
// build:mac / build:linux scripts skips the rebuild without touching the YAML.
module.exports = async () => {}
