#include <napi.h>

#ifdef _WIN32
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

// --- Runtime-patch primitives -------------------------------------------------
//
// The hostname/port/skip-intro style patches only overwrite existing bytes, so
// WriteProcessMemory alone was enough. A hook patch also needs somewhere to put
// its trampoline: memory allocated INSIDE the target, made executable, with the
// instruction cache flushed before the process is resumed.

// virtualAllocEx(handle: BigInt, size: number, allocType: number, protect: number)
//   -> BigInt base address
Napi::Value VirtualAllocEx_(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE h = BigIntToHandle(info[0].As<Napi::BigInt>());
  SIZE_T size = static_cast<SIZE_T>(info[1].As<Napi::Number>().Int64Value());
  DWORD allocType = info[2].As<Napi::Number>().Uint32Value();
  DWORD protect = info[3].As<Napi::Number>().Uint32Value();

  LPVOID addr = VirtualAllocEx(h, nullptr, size, allocType, protect);
  if (!addr) {
    Napi::Error::New(env, "VirtualAllocEx failed: " + std::to_string(GetLastError()))
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::BigInt::New(env, static_cast<uint64_t>(reinterpret_cast<uintptr_t>(addr)));
}

// virtualFreeEx(handle: BigInt, address: BigInt) -> void
// Always MEM_RELEASE (size must be 0 for it), which is what the rollback path wants.
Napi::Value VirtualFreeEx_(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE h = BigIntToHandle(info[0].As<Napi::BigInt>());
  bool lossless;
  uint64_t addr = info[1].As<Napi::BigInt>().Uint64Value(&lossless);
  LPVOID target = reinterpret_cast<LPVOID>(static_cast<uintptr_t>(addr));

  if (!VirtualFreeEx(h, target, 0, MEM_RELEASE)) {
    Napi::Error::New(env, "VirtualFreeEx failed: " + std::to_string(GetLastError()))
      .ThrowAsJavaScriptException();
  }
  return env.Undefined();
}

// virtualProtectEx(handle: BigInt, address: BigInt, size: number, protect: number)
//   -> number (the previous protection, for restoring it afterwards)
Napi::Value VirtualProtectEx_(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE h = BigIntToHandle(info[0].As<Napi::BigInt>());
  bool lossless;
  uint64_t addr = info[1].As<Napi::BigInt>().Uint64Value(&lossless);
  LPVOID target = reinterpret_cast<LPVOID>(static_cast<uintptr_t>(addr));
  SIZE_T size = static_cast<SIZE_T>(info[2].As<Napi::Number>().Int64Value());
  DWORD protect = info[3].As<Napi::Number>().Uint32Value();

  DWORD previous = 0;
  if (!VirtualProtectEx(h, target, size, protect, &previous)) {
    Napi::Error::New(env, "VirtualProtectEx failed: " + std::to_string(GetLastError()))
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Number::New(env, static_cast<double>(previous));
}

// flushInstructionCache(handle: BigInt, address: BigInt, size: number) -> void
Napi::Value FlushInstructionCache_(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE h = BigIntToHandle(info[0].As<Napi::BigInt>());
  bool lossless;
  uint64_t addr = info[1].As<Napi::BigInt>().Uint64Value(&lossless);
  LPCVOID target = reinterpret_cast<LPCVOID>(static_cast<uintptr_t>(addr));
  SIZE_T size = static_cast<SIZE_T>(info[2].As<Napi::Number>().Int64Value());

  if (!FlushInstructionCache(h, target, size)) {
    Napi::Error::New(env, "FlushInstructionCache failed: " + std::to_string(GetLastError()))
      .ThrowAsJavaScriptException();
  }
  return env.Undefined();
}

// terminateProcess(handle: BigInt, exitCode: number) -> void
// The fail-closed path: a suspended client that failed verification must never
// be resumed half-patched.
Napi::Value TerminateProcess_(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE h = BigIntToHandle(info[0].As<Napi::BigInt>());
  UINT code = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().Uint32Value() : 1;
  TerminateProcess(h, code);
  return env.Undefined();
}

// getMainModuleBase(handle: BigInt) -> BigInt
//
// Where the target's main image actually landed. Dark Ages prefers 0x00400000
// and in practice gets it (it has no relocation table), but the appendix's
// launcher rules are explicit that a runtime address is `module base + RVA` —
// so resolve the base rather than assume it.
//
// The route matters: Epona is x64 and Dark Ages.exe is a 32-bit WOW64 child, so
// the ordinary PEB is the 64-bit one. ProcessWow64Information hands back the
// address of the child's *32-bit* PEB, whose ImageBaseAddress sits at +0x08 as a
// 32-bit pointer. This also works on a process suspended at creation, where the
// loader has not run and the module list is not yet populated (so
// EnumProcessModules is unreliable there).
typedef LONG (WINAPI *NtQueryInformationProcessFn)(HANDLE, ULONG, PVOID, ULONG, PULONG);
static const ULONG kProcessWow64Information = 26;

Napi::Value GetMainModuleBase(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE h = BigIntToHandle(info[0].As<Napi::BigInt>());

  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  NtQueryInformationProcessFn query = ntdll
    ? reinterpret_cast<NtQueryInformationProcessFn>(
        reinterpret_cast<void*>(GetProcAddress(ntdll, "NtQueryInformationProcess")))
    : nullptr;
  if (!query) {
    Napi::Error::New(env, "NtQueryInformationProcess unavailable").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  ULONG_PTR peb32 = 0;
  ULONG returned = 0;
  LONG status = query(h, kProcessWow64Information, &peb32, sizeof(peb32), &returned);
  if (status < 0 || peb32 == 0) {
    Napi::Error::New(env, "target is not a 32-bit (WOW64) process, or the PEB is unreadable")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // PEB32.ImageBaseAddress — a 32-bit pointer at offset 0x08.
  uint32_t imageBase = 0;
  SIZE_T read = 0;
  if (!ReadProcessMemory(h, reinterpret_cast<LPCVOID>(peb32 + 0x08), &imageBase,
                         sizeof(imageBase), &read) || read != sizeof(imageBase)) {
    Napi::Error::New(env, "could not read PEB32.ImageBaseAddress: " + std::to_string(GetLastError()))
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (imageBase == 0) {
    Napi::Error::New(env, "PEB32.ImageBaseAddress is null").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::BigInt::New(env, static_cast<uint64_t>(imageBase));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createSuspendedProcess", Napi::Function::New(env, CreateSuspendedProcess));
  exports.Set("openProcess",            Napi::Function::New(env, OpenProcess_));
  exports.Set("writeProcessMemory",     Napi::Function::New(env, WriteProcessMemory_));
  exports.Set("readProcessMemory",      Napi::Function::New(env, ReadProcessMemory_));
  exports.Set("resumeThread",           Napi::Function::New(env, ResumeThread_));
  exports.Set("suspendThread",          Napi::Function::New(env, SuspendThread_));
  exports.Set("closeHandle",            Napi::Function::New(env, CloseHandle_));
  exports.Set("virtualAllocEx",         Napi::Function::New(env, VirtualAllocEx_));
  exports.Set("virtualFreeEx",          Napi::Function::New(env, VirtualFreeEx_));
  exports.Set("virtualProtectEx",       Napi::Function::New(env, VirtualProtectEx_));
  exports.Set("flushInstructionCache",  Napi::Function::New(env, FlushInstructionCache_));
  exports.Set("terminateProcess",       Napi::Function::New(env, TerminateProcess_));
  exports.Set("getMainModuleBase",      Napi::Function::New(env, GetMainModuleBase));
  return exports;
}

#else  // !_WIN32

// da-win32 wraps Win32 process-interop APIs and is only require()'d on
// Windows (index.js loads it unconditionally, but src/main/targets/
// legacyTarget.js gates that require behind process.platform === 'win32').
// On other platforms we still need a buildable, loadable addon so `npm ci`
// / electron-builder install-app-deps can compile the package — it just
// exports nothing.
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  return exports;
}

#endif  // _WIN32

NODE_API_MODULE(da_win32, Init)
