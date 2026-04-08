{
  "targets": [{
    "target_name": "da_win32",
    "sources": ["src/addon.cc"],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "conditions": [["OS=='win'", { "libraries": ["-lkernel32"] }]]
  }]
}
