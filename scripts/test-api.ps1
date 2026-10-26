# Ad-hoc probe of the local ComfyUI HTTP API (used while developing the DSH plugin).
# Usage: pwsh -File scripts/test-api.ps1 [-Prompt "text"] [-Width 832] [-Height 1216]
param(
  [string]$BaseUrl = 'http://127.0.0.1:8188',
  [string]$Prompt = 'masterpiece, best quality, 1girl, solo, silver hair, blue eyes, school uniform, cherry blossoms, spring, soft lighting, detailed background',
  [string]$Negative = 'lowres, bad anatomy, bad hands, text, error, worst quality, low quality, jpeg artifacts, watermark, signature, blurry',
  [string]$Checkpoint = 'waiIllustriousSDXL_v170.safetensors',
  [int]$Width = 832,
  [int]$Height = 1216,
  [int]$Steps = 24,
  [double]$Cfg = 5.0,
  [string]$Sampler = 'dpmpp_2m',
  [string]$Scheduler = 'karras',
  [int]$Seed = 12345
)

$ErrorActionPreference = 'Stop'

$graph = @{
  '4' = @{ class_type = 'CheckpointLoaderSimple'; inputs = @{ ckpt_name = $Checkpoint } }
  '6' = @{ class_type = 'CLIPTextEncode'; inputs = @{ clip = @('4', 1); text = $Prompt } }
  '7' = @{ class_type = 'CLIPTextEncode'; inputs = @{ clip = @('4', 1); text = $Negative } }
  '5' = @{ class_type = 'EmptyLatentImage'; inputs = @{ width = $Width; height = $Height; batch_size = 1 } }
  '3' = @{ class_type = 'KSampler'; inputs = @{
      seed = $Seed; steps = $Steps; cfg = $Cfg; sampler_name = $Sampler; scheduler = $Scheduler; denoise = 1.0
      model = @('4', 0); positive = @('6', 0); negative = @('7', 0); latent_image = @('5', 0) } }
  '8' = @{ class_type = 'VAEDecode'; inputs = @{ samples = @('3', 0); vae = @('4', 2) } }
  '9' = @{ class_type = 'SaveImage'; inputs = @{ filename_prefix = 'dsh_probe'; images = @('8', 0) } }
}

$body = @{ prompt = $graph; client_id = 'dsh-plugin-probe' } | ConvertTo-Json -Depth 12 -Compress
$started = Get-Date
$queued = Invoke-RestMethod -Uri "$BaseUrl/prompt" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
Write-Host "queued: $($queued | ConvertTo-Json -Compress)"
$promptId = $queued.prompt_id
if (-not $promptId) { throw "no prompt_id returned: $($queued | ConvertTo-Json -Depth 8)" }

$deadline = $started.AddMinutes(10)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 800
  try {
    $h = Invoke-RestMethod -Uri "$BaseUrl/history/$promptId" -TimeoutSec 15
  } catch { continue }
  if ($h.PSObject.Properties.Name -contains $promptId) {
    $entry = $h.$promptId
    Write-Host "DONE in $([math]::Round(((Get-Date) - $started).TotalSeconds,1))s"
    $entry | ConvertTo-Json -Depth 10
    foreach ($nodeId in $entry.outputs.PSObject.Properties.Name) {
      foreach ($img in $entry.outputs.$nodeId.images) {
        Write-Host ("IMAGE {0} subfolder='{1}' type={2}" -f $img.filename, $img.subfolder, $img.type)
      }
    }
    exit 0
  }
}
throw 'timeout waiting for history'
