; Payload is staged into installer\staging by scripts\build-installer.ps1; compile through that
; script rather than opening this file directly, or the staging folder will be stale or missing.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{8F3C6A21-5D74-4E9B-9C1E-2B7A0D4F6E58}
AppName=VibePPT
AppVersion={#AppVersion}
AppVerName=VibePPT {#AppVersion}
AppPublisher=Bùi Mạnh Thành
AppPublisherURL=https://github.com/Thanh25102/vibeppt
AppSupportURL=https://github.com/Thanh25102/vibeppt/issues
VersionInfoVersion=0.4.0.0
; Per-user install: no administrator prompt, which is the whole point of shipping an installer.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\VibePPT
DefaultGroupName=VibePPT
DisableProgramGroupPage=yes
DisableDirPage=auto
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
LicenseFile=..\LICENSE.md
OutputDir=..\dist-installer
OutputBaseFilename=VibePPT-Setup-{#AppVersion}
UninstallDisplayName=VibePPT {#AppVersion}
UninstallDisplayIcon={app}\node.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "staging\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\VibePPT Studio"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\start-studio.ps1"""; \
  WorkingDir: "{app}"; Comment: "Open the local VibePPT template gallery"

[Registry]
; The agent drives `vibeppt` from a shell, so the command has to be on PATH, not just the Start Menu.
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; \
  Check: NeedsAddPath(ExpandConstant('{app}'))

[Run]
Filename: "{app}\vibeppt.cmd"; Parameters: "setup --no-shortcut"; \
  StatusMsg: "Installing the Codex and Claude Code skills..."; Flags: runhidden waituntilterminated
Filename: "{app}\vibeppt.cmd"; Parameters: "studio"; Description: "Open VibePPT Studio now"; \
  Flags: postinstall nowait skipifsilent runhidden unchecked

[Code]
function NeedsAddPath(Directory: string): boolean;
var
  Existing: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Existing) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Uppercase(Directory) + ';', ';' + Uppercase(Existing) + ';') = 0;
end;

procedure RemoveFromPath(Directory: string);
var
  Existing: string;
  Position: Integer;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Existing) then exit;
  // The value is searched wrapped in separators so a match in first or last position is found
  // too. Pos is 1-based over that padded copy, so every index has to be translated back before
  // Delete touches the real value, otherwise the entry goes but its separator stays behind.
  Position := Pos(';' + Uppercase(Directory) + ';', ';' + Uppercase(Existing) + ';');
  if Position = 0 then exit;
  if Position = 1 then Delete(Existing, 1, Length(Directory) + 1)
  else Delete(Existing, Position - 1, Length(Directory) + 1);
  RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Existing);
end;

procedure CurUninstallStepChanged(CurStep: TUninstallStep);
begin
  // The installed skills under ~/.codex and ~/.claude are left alone on purpose: the user may
  // have edited them, and they are harmless without the CLI.
  if CurStep = usPostUninstall then RemoveFromPath(ExpandConstant('{app}'));
end;
