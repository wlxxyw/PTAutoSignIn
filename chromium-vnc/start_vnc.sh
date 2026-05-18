#!/bin/bash
AUTH_OPTION=""
if [ -n "$VNC_PASS" ]; then
  printf "%s" "$VNC_PASS" | vncpasswd -f > /root/.vncpwd
  chmod 600 /root/.vncpwd
  AUTH_OPTION="-SecurityTypes VncAuth -PasswordFile /root/.vncpwd"
else
  AUTH_OPTION="-SecurityTypes None"
fi
exec x0vncserver -display :99 $AUTH_OPTION -rfbport 5900