# Math Playground

Interactive math demos for an iPad at a recruiting booth. It's plain HTML/CSS/JS with no build step and no dependencies, and it works offline once installed.

| Demo | What visitors do | The math behind it |
|---|---|---|
| Tower of Hanoi | Move the tower in the fewest moves, or watch auto-solve | Recursion, induction, 2ⁿ − 1 |
| Fractal Maker | Draw a rule like `_/\_` and watch it become a Koch snowflake | Self-similarity, fractal dimension |
| Fourier Circles | Draw a shape; spinning circles redraw it | Fourier series, complex numbers |
| Fluid Paint | Swirl liquid with several fingers | Navier–Stokes PDEs |
| Code Breaker | Crack Caesar, substitution and Vigenère ciphers | Modular arithmetic, cryptography |
| Kaleidoscope | Draw with n-fold symmetry | Group theory (dihedral groups) |
| Chaos Game | Random jumps that build the Sierpiński triangle and Barnsley fern | Iterated function systems |
| Lights Out | Turn off every light | Linear algebra over GF(2) |
| Galton Board | Drop balls and watch a bell curve form | Binomial distribution, CLT |

Every demo has a **"Where's the math?"** button that opens a short explainer.

## Run locally

```bash
python3 serve.py
```

Open http://localhost:8000. The script also prints a LAN address, so you can test on an iPad that's on the same Wi-Fi.
`serve.py` turns off caching. The service worker is skipped on `localhost`; add `?sw=1` to test it there.

## Put it online (needed for offline use on the iPad)

Service workers only work over HTTPS, so host the folder on a static host. With GitHub Pages:

1. Create a repo, push this folder, then go to **Settings → Pages → Deploy from branch → main / root**.
2. Open `https://<user>.github.io/<repo>/` once on the iPad.

After changing any file, bump `VERSION` in `sw.js` so iPads pick up the new copy.

## iPad booth setup

1. In Safari, open the hosted URL, then tap **Share → Add to Home Screen**. It now opens full-screen like an app.
2. Open it from the Home Screen, tap through each demo once, then turn on Airplane Mode and check that everything still loads.
3. **Kiosk reset:** open it once with `?kiosk=1` added to the URL. After 2 minutes with no touches, it returns to the menu. `?kiosk=0` turns this off.
4. **Lock it to the app:** go to Settings → Accessibility → Guided Access → On. In the app, triple-click the side button to start.
5. Set Settings → Display & Brightness → Auto-Lock → Never, and keep the iPad plugged in.

## Layout

```
index.html            menu
shared/style.css      theme + components shared by all demos
shared/common.js      MP helpers: canvas sizing, drawer, toast/modal, confetti, kiosk reset, SW registration
demos/<name>.html/.js one page per demo
sw.js, manifest.webmanifest, icons/   offline/PWA support
```
