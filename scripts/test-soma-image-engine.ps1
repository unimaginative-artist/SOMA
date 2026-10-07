param(
    [string]$SomaUrl = "http://localhost:3001",
    [string]$Prompt = "SOMA standing inside a calm violet neural network, cinematic, no text"
)

$ErrorActionPreference = "Stop"

$body = @{
    prompt = $Prompt
    width = 512
    height = 512
} | ConvertTo-Json

$result = Invoke-RestMethod -Method Post "$SomaUrl/api/social/images/generate" `
    -ContentType "application/json" `
    -Body $body

$result | ConvertTo-Json -Depth 8
