param(
  [Parameter(Mandatory = $true)][string]$SourcePath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Compress-Archive -LiteralPath $SourcePath -DestinationPath $OutputPath -CompressionLevel Optimal
