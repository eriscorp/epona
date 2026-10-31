#!/usr/bin/env bash
# HTOO-627 machine checks M2 (HTOO-644), M5 (HTOO-646) and M6 (HTOO-654), on macOS or Linux.
#
# Builds throwaway projects in a temp folder; touches no repo. Needs the .NET 10 SDK and git.
#   bash docs/plans/01-box-checks/build-and-git.sh
set -u
EPONA="$(cd "$(dirname "$0")/../../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
proj='<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>'
app='<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>
  <ItemGroup><ProjectReference Include="$(LocalXmlProjectPath)" Condition="'"'"'$(UseLocalXml)'"'"' == '"'"'true'"'"'" /></ItemGroup>
</Project>'
write_props() { # <server dir> <xml csproj> — Epona's own writeBuildProps
  node --input-type=module -e "const {writeBuildProps}=await import('$EPONA/src/main/buildProps.js'); await writeBuildProps(process.argv[1], process.argv[2])" "$1" "$2" 2>/dev/null
}
xml_type() { # <server dir> → the type restore gave Hybrasyl.Xml, or "none"
  (cd "$1" && dotnet restore hybrasyl/Hybrasyl.csproj >/dev/null 2>&1)
  python3 -I -c "import json,sys;d=json.load(open(sys.argv[1]));print(next((v.get('type') for k,v in d['libraries'].items() if k.startswith('Hybrasyl.Xml/')),'none'))" "$1/hybrasyl/obj/project.assets.json"
}

# M5 — does a worktree at <repo>/.worktrees/<branch>/ import the repo root's Directory.Build.props?
mkdir -p "$T/m5/repo/.worktrees/feature__x/hybrasyl"
echo '<Project><PropertyGroup><UseLocalProtocol>true</UseLocalProtocol></PropertyGroup></Project>' > "$T/m5/repo/Directory.Build.props"
echo "$proj" > "$T/m5/repo/.worktrees/feature__x/hybrasyl/Hybrasyl.csproj"
v=$(cd "$T/m5/repo/.worktrees/feature__x" && dotnet msbuild hybrasyl/Hybrasyl.csproj -getProperty:UseLocalProtocol 2>&1 | tail -1)
echo "M5 RESULT: the worktree project sees UseLocalProtocol='$v' from the repo root (true = HTOO-646 confirmed)"

# M6 — does Epona's backslash LocalXmlProjectPath resolve? And a folder name with '&'?
for case in plain 'R&D'; do
  d="$T/m6-$case"; mkdir -p "$d/$case/xml/src" "$d/server/hybrasyl"
  echo "$proj" > "$d/$case/xml/src/Hybrasyl.Xml.csproj"; echo "$app" > "$d/server/hybrasyl/Hybrasyl.csproj"
  write_props "$d/server" "$d/$case/xml/src/Hybrasyl.Xml.csproj"
  echo "M6 RESULT ($case folder): Hybrasyl.Xml restored as '$(xml_type "$d/server")' (project = resolved; none = reference dropped)"
done

# M2 — does a non-force `git worktree remove` delete a worktree while a process runs from it?
mkdir -p "$T/m2" && cd "$T/m2" && git init -q repo && cd repo
printf 'bin/\nobj/\n.worktrees/\n' > .gitignore && echo x > a.txt && git add . && git -c user.email=t@t -c user.name=t commit -qm init && git branch feat
git worktree add -q .worktrees/feat feat && mkdir -p .worktrees/feat/bin && echo data > .worktrees/feat/bin/content.dat
bash -c 'cd .worktrees/feat/bin && exec 3<content.dat && exec sleep 30' & APP=$!
sleep 1
if git worktree remove .worktrees/feat 2>/dev/null; then r=removed; else r=refused; fi
echo "M2 RESULT: git worktree remove $r the worktree; folder $(test -d .worktrees/feat && echo kept || echo gone); process $(kill -0 $APP 2>/dev/null && echo still running || echo gone) (removed + gone folder + running = HTOO-644 consequence confirmed)"
kill $APP 2>/dev/null; wait 2>/dev/null
