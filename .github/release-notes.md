OpenVSP Studio bundled with OpenVSP 3.54.0. Pick the installer for your system:

- **Windows**: `.msi` (x64; also runs on Windows on ARM).
- **macOS**: `.dmg` for Apple Silicon (`aarch64`) or Intel (`x64`). The app is not notarized, so if macOS says it is damaged, run `xattr -cr "/Applications/OpenVSP Studio.app"` once.
- **Linux**: `.deb` for Ubuntu 24.04. Install it with `sudo apt install ./OpenVSP*.deb`, which also pulls in Python 3.12 and NumPy.
