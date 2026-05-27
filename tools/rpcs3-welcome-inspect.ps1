Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement

function Find-WelcomeDialog([System.Windows.Automation.AutomationElement]$scopeRoot) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $node = $walker.GetFirstChild($scopeRoot)
  while ($node -ne $null) {
    try {
      $name = [string]$node.Current.Name
      $controlType = $node.Current.ControlType
      if ($controlType -eq [System.Windows.Automation.ControlType]::Window -and (($name -eq 'Welcome to RPCS3') -or ($name -like '*Welcome*RPCS3*'))) {
        return $node
      }
      $desc = Find-WelcomeDialog $node
      if ($desc -ne $null) { return $desc }
    } catch {}
    $node = $walker.GetNextSibling($node)
  }
  return $null
}

function Dump-Tree([System.Windows.Automation.AutomationElement]$scopeRoot, [int]$depth) {
  if ($null -eq $scopeRoot -or $depth -gt 6) { return }
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $node = $walker.GetFirstChild($scopeRoot)
  while ($node -ne $null) {
    try {
      $indent = ('  ' * $depth)
      $name = [string]$node.Current.Name
      $automationId = [string]$node.Current.AutomationId
      $className = [string]$node.Current.ClassName
      $controlType = [string]$node.Current.ControlType.ProgrammaticName
      $enabled = [string]$node.Current.IsEnabled
      Write-Output ("${indent}Name=$name | AutomationId=$automationId | ClassName=$className | ControlType=$controlType | Enabled=$enabled")
      Dump-Tree $node ($depth + 1)
    } catch {}
    $node = $walker.GetNextSibling($node)
  }
}

$dialog = Find-WelcomeDialog $root
if ($null -eq $dialog) {
  Write-Output 'not-found'
  exit 0
}

Write-Output (("Dialog: Name={0} | AutomationId={1} | ClassName={2}") -f [string]$dialog.Current.Name, [string]$dialog.Current.AutomationId, [string]$dialog.Current.ClassName)
Dump-Tree $dialog 1
