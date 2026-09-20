!macro customInit
  nsExec::ExecToStack 'taskkill /F /T /IM "Resto FADEY.exe"'
  Pop $0
  Pop $1
!macroend

; Tras instalar, la app arranca (runAfterFinish) y solicita cámara/mic/notificaciones
; una sola vez en el proceso Electron (primeDesktopOsPermissions), no al abrir cocina/QR.
!macro customInstall
!macroend
