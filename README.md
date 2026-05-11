# Personal Researcher Homepage

A pastel, cute personal homepage for a researcher. Plain HTML / CSS / JS — no build step.

## Files

- `index.html` — Home (About, Research, Contact)
- `publications.html` — Papers & preprints with filter chips
- `cv.html` — Curriculum vitae
- `styles.css` — Pastel theme
- `script.js` — Light interactivity (year, mobile nav, publication filter)

## How to publish to GitHub Pages (`username.github.io`)

1. Create a new repository on GitHub named **exactly** `username.github.io`
   (replace `username` with your actual GitHub username — case insensitive but must match).
2. Upload all files in this folder to the repository's root (or push them via git).
   ```bash
   git init
   git add .
   git commit -m "Initial homepage"
   git branch -M main
   git remote add origin https://github.com/<username>/<username>.github.io.git
   git push -u origin main
   ```
3. Open the repository on GitHub → **Settings** → **Pages**.
4. Under **Build and deployment**, set **Source** to *Deploy from a branch*,
   pick the `main` branch and `/ (root)` folder, and save.
5. Wait ~1 minute, then visit `https://<username>.github.io`.

## Customizing

Open the `.html` files in any editor and replace placeholders like:

- `[Your Name]`, `[Your Field]`, `[Your Affiliation]`
- `[your.email@example.com]`
- The publication entries, CV timeline, etc.

The color palette lives at the top of `styles.css` under `:root` — tweak the
pastel pinks / lavenders / mints there to change the whole look.
