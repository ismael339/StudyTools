param([string]$file)
$f = Get-Content $file
$f | Select-String -Pattern 'faq-section|site-footer|sticky-banner|email-popup|toggleFAQ'