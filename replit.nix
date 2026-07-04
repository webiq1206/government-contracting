{pkgs}: {
  deps = [
    pkgs.chromium
    pkgs.libxkbcommon
    pkgs.alsa-lib
    pkgs.mesa
    pkgs.xorg.libxcb
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.xorg.libX11
    pkgs.libdrm
    pkgs.dbus
    pkgs.cups
    pkgs.at-spi2-atk
    pkgs.nss
    pkgs.glib
  ];
}
