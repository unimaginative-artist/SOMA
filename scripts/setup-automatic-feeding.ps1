# setup-automatic-feeding.ps1
# Sets up Windows Task Scheduler to automatically feed SOMA daily

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  SOMA AUTOMATIC DAILY FEEDING SETUP" -ForegroundColor Cyan
Write-Host "  Setting up Windows Task Scheduler..." -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Get the current directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Split-Path -Parent $scriptPath
$batchFile = Join-Path $scriptPath "feed-soma-daily.bat"

Write-Host "Project Path: $projectPath" -ForegroundColor Yellow
Write-Host "Batch File: $batchFile" -ForegroundColor Yellow
Write-Host ""

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "WARNING: Not running as administrator" -ForegroundColor Red
    Write-Host "Task will be created for current user only" -ForegroundColor Yellow
    Write-Host ""
}

# Task configuration
$taskName = "SOMA-DailyFeed"
$taskDescription = "Automatically feeds SOMA new knowledge daily at 6 PM"
$taskTime = "18:00"  # 6 PM

Write-Host "Creating scheduled task:" -ForegroundColor Green
Write-Host "  Name: $taskName" -ForegroundColor White
Write-Host "  Time: $taskTime (6 PM daily)" -ForegroundColor White
Write-Host "  Action: Run $batchFile" -ForegroundColor White
Write-Host ""

try {
    # Delete existing task if it exists
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Write-Host "Removing existing task..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }

    # Create the action
    $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$batchFile`"" -WorkingDirectory $projectPath

    # Create the trigger (daily at 6 PM)
    $trigger = New-ScheduledTaskTrigger -Daily -At $taskTime

    # Create settings
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RunOnlyIfNetworkAvailable:$false

    # Create the principal (user context)
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U

    # Register the task
    Register-ScheduledTask `
        -TaskName $taskName `
        -Description $taskDescription `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Force | Out-Null

    Write-Host "SUCCESS! Scheduled task created!" -ForegroundColor Green
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  AUTOMATIC FEEDING CONFIGURED" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Schedule:" -ForegroundColor Yellow
    Write-Host "  Every day at 6:00 PM" -ForegroundColor White
    Write-Host "  SOMA will receive fresh knowledge automatically" -ForegroundColor White
    Write-Host ""
    Write-Host "What happens:" -ForegroundColor Yellow
    Write-Host "  1. At 6 PM: New knowledge feed is created" -ForegroundColor White
    Write-Host "  2. At 10 PM: SOMA begins nightly learning" -ForegroundColor White
    Write-Host "  3. By 3 AM: SOMA has learned all new knowledge" -ForegroundColor White
    Write-Host ""
    Write-Host "To check the task:" -ForegroundColor Yellow
    Write-Host "  Open Task Scheduler -> Task Scheduler Library -> $taskName" -ForegroundColor White
    Write-Host ""
    Write-Host "To run manually:" -ForegroundColor Yellow
    Write-Host "  schtasks /run /tn `"$taskName`"" -ForegroundColor White
    Write-Host ""
    Write-Host "To disable:" -ForegroundColor Yellow
    Write-Host "  schtasks /change /tn `"$taskName`" /disable" -ForegroundColor White
    Write-Host ""
    Write-Host "Log file:" -ForegroundColor Yellow
    Write-Host "  $projectPath\logs\daily-feed.log" -ForegroundColor White
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan

} catch {
    Write-Host "ERROR: Failed to create scheduled task" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Manual setup instructions:" -ForegroundColor Yellow
    Write-Host "1. Open Task Scheduler (taskschd.msc)" -ForegroundColor White
    Write-Host "2. Create Basic Task" -ForegroundColor White
    Write-Host "3. Name: SOMA-DailyFeed" -ForegroundColor White
    Write-Host "4. Trigger: Daily at 6:00 PM" -ForegroundColor White
    Write-Host "5. Action: Start a program" -ForegroundColor White
    Write-Host "6. Program: cmd.exe" -ForegroundColor White
    Write-Host "7. Arguments: /c `"$batchFile`"" -ForegroundColor White
    Write-Host "8. Start in: $projectPath" -ForegroundColor White
}
