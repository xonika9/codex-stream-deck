param(
  [string]$MacArchivePath,
  [string]$ReleaseVersion
)

$ErrorActionPreference = 'Stop'
$arguments = @('scripts/prepare-release.mjs')
if (-not [string]::IsNullOrWhiteSpace($ReleaseVersion)) {
  $arguments += @('--version', $ReleaseVersion.Trim())
}
if (-not [string]::IsNullOrWhiteSpace($MacArchivePath)) {
  $arguments += @('--mac-archive', $MacArchivePath)
}

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $root
try {
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw "Release preparation failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}
