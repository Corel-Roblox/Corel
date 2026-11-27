# Corel trailer

`trailer.html` is the trailer (1920×1080, 43 s). Open it in a browser to watch it play live (R restarts).
It uses the screenshots in `docs/img`, so retake those first if the app's look changes.

Render it to MP4 (needs Node, Microsoft Edge and ffmpeg):

```powershell
npm install --no-save puppeteer-core
node brand/trailer/render.mjs brand/trailer/trailer.html brand/trailer/frames 30
ffmpeg -framerate 30 -i brand/trailer/frames/f%05d.jpg -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart brand/trailer/corel-trailer.mp4
```

The video is silent; add music in any editor.
