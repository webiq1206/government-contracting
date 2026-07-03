{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.nodePackages.npm
    # Chromium runtime deps for optional Playwright state-license scrapers.
    pkgs.chromium
  ];
  env = {
    # Point Playwright at the Nix-provided Chromium so it does not download one.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
  };
}
