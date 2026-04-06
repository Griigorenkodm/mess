# Deploy to Render

1. Push this project to a GitHub repository.
2. Open [Render](https://render.com/) and click **New +** -> **Blueprint**.
3. Select your repository and confirm deploy.
4. Wait for build to complete, then open the generated `onrender.com` URL.

## Notes

- Render free URL is stable (does not change every restart).
- Free plan may sleep after inactivity.
- Local file storage on free instances is ephemeral, so files in `data/` can reset after redeploy/restart.
