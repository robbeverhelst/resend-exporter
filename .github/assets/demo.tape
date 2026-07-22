# VHS tape for the README demo gif — https://github.com/charmbracelet/vhs
# Regenerate with: vhs .github/assets/demo.tape  (run from the repo root)
Output .github/assets/demo.gif

Set Shell bash
Set FontSize 15
Set Width 1000
Set Height 620
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms

Type "docker run -d -p 8080:8080 -e RESEND_WEBHOOK_SECRET=whsec_c2VjcmV0 ghcr.io/robbeverhelst/resend-exporter"
Enter
Sleep 3s

Type "# forged requests get rejected"
Enter
Type "curl -si -X POST localhost:8080/webhooks/resend -d '{}' | head -1"
Enter
Sleep 2.5s

Type "# now a real, signed Resend event"
Enter
Type "RESEND_WEBHOOK_SECRET=whsec_c2VjcmV0 bun scripts/send-test-event.ts email.bounced"
Enter
Sleep 2.5s

Type "curl -s localhost:8080/metrics | grep '^resend_'"
Enter
Sleep 6s
