#include <napi.h>
#include <windows.h>

// Helper: BigInt <-> HANDLE (stored as uint64_t)
static HANDLE BigIntToHandle(const Napi::BigInt& val) {
  bool lossless;
  uint64_t v = val.Uint64Value(&lossless);
  return reinterpret_cast<HANDLE>(static_cast<uintptr_t>(v));
}

static Napi::BigInt HandleToBigInt(Napi::Env env, HANDLE h) {
  return Napi::BigInt::New(env, static_cast<uint64_t>(reinterpret_cast<uintptr_t>(h)));
}

// createSuspendedProcess(exePath: string, cmdLine?: string)
// Returns { processId, threadId, processHandle, threadHandle }
Napi::Value CreateSuspendedProcess(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  std::string exePath = info[0].As<Napi::String>();
  std::string cmdLine = info.Length() > 1 && info[1].IsString()
    ? info[1].As<Napi::String>().Utf8Value()
    : "";

  STARTUPINFOA si = {};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi = {};

  BOOL ok = CreateProcessA(
    exePath.c_str(),
    cmdLine.empty() ? nullptr : const_cast<char*>(cmdLine.c_str()),
    nullptr, nullptr, FALSE,
    CREATE_SUSPENDED,
    nullptr, nullptr,
    &si, &pi
  );

  if (!ok) {
    Napi::Error::New(env, "CreateProcess failed: " + std::to_string(GetLastError()))
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("processId",    Napi::Number::New(env, static_cast<double>(pi.dwProcessId)));
  result.Set("threadId",     Napi::Number::New(env, static_cast<double>(pi.dwThreadId)));
  result.Set("processHandle", HandleToBigInt(env, pi.hProcess));
  result.Set("threadHandle",  HandleToBigInt(env, pi.hThread));
  return result;
}

// openProcess(pid: number, accessFlags: number) -> BigInt handle
Napi::Value OpenProcess_(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  DWORD pid = info[0].As<Napi::Number>().Uint32Value();
  DWORD access = info[1].As<Napi::Number>().Uint32Value();

  HANDLE h = OpenProcess(access, FALSE, pid);
  if (!h) {
    Napi::Error::New(env, "OpenProcess failed: " + std::to_string(GetLastError()))
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return HandleToBigInt(env, h);
}

// writeProcessMemory(handle: BigInt, address: BigInt, buffer: Buffer) -> void
Napi::Value WriteProcessMemory_(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE h = BigIntToHandle(info[0].As<Napi::BigInt>());

  bool lossless;
  uint64_t addr = info[1].As<Napi::BigInt>().Uint64Value(&lossless);
  LPVOID target = reinterpret_cast<LPVOID>(static_cast<uintptr_t>(addr));

  Napi::Buffer<uint8_t> buf = info[2].As<Napi::Buffer<uint8_t>>();

  SIZE_T written;
  BOOL ok = WriteProcessMemory(h, target, buf.Data(), buf.ByteLength(), &written);
  if (!ok) {
    Napi::Error::New(env, "WriteProcessMemory failed: " + std::to_string(GetLastError()))
      .ThrowAsJavaScriptException();
  }
  return env.Undefined();
}

// readProcessMemory(handle: BigInt, address: BigInt, size: number) -> Buffer
Napi::Value ReadProcessMemory_(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE h = BigIntToHandle(info[0].As<Napi::BigInt>());

  bool lossless;
  uint64_t addr = info[1].As<Napi::BigInt>().Uint64Value(&lossless);
  LPVOID src = reinterpret_cast<LPVOID>(static_cast<uintptr_t>(addr));
  size_t size = info[2].As<Napi::Number>().Uint32Value();

  Napi::Buffer<uint8_t> buf = Napi::Buffer<uint8_t>::New(env, size);
  SIZE_T read;
  BOOL ok = ReadProcessMemory(h, src, buf.Data(), size, &read);
  if (!ok) {
    Napi::Error::New(env, "ReadProcessMemory failed: " + std::to_string(GetLastError()))
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return buf;
}

// resumeThread(threadHandle: BigInt) -> number (previous suspension count)
Napi::Value ResumeThread_(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE h = BigIntToHandle(info[0].As<Napi::BigInt>());
  DWORD prev = ResumeThread(h);
  if (prev == (DWORD)-1) {
    Napi::Error::New(env, "ResumeThread failed: " + std::to_string(GetLastError()))
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Number::New(env, static_cast<double>(prev));
}

// suspendThread(threadHandle: BigInt) -> number (previous suspension count)
Napi::Value SuspendThread_(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE h = BigIntToHandle(info[0].As<Napi::BigInt>());
  DWORD prev = SuspendThread(h);
  if (prev == (DWORD)-1) {
    Napi::Error::New(env, "SuspendThread failed: " + std::to_string(GetLastError()))
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Number::New(env, static_cast<double>(prev));
}

// closeHandle(handle: BigInt) -> void
Napi::Value CloseHandle_(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE h = BigIntToHandle(info[0].As<Napi::BigInt>());
  CloseHandle(h);
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createSuspendedProcess", Napi::Function::New(env, CreateSuspendedProcess));
  exports.Set("openProcess",            Napi::Function::New(env, OpenProcess_));
  exports.Set("writeProcessMemory",     Napi::Function::New(env, WriteProcessMemory_));
  exports.Set("readProcessMemory",      Napi::Function::New(env, ReadProcessMemory_));
  exports.Set("resumeThread",           Napi::Function::New(env, ResumeThread_));
  exports.Set("suspendThread",          Napi::Function::New(env, SuspendThread_));
  exports.Set("closeHandle",            Napi::Function::New(env, CloseHandle_));
  return exports;
}

NODE_API_MODULE(da_win32, Init)
