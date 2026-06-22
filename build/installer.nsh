!macro customInit
  nsExec::ExecToStack 'taskkill /F /T /IM "Resto FADEY.exe"'
  Pop $0
  Pop $1
!macroend
