# SCAD Evidence & Gap Assessment Dashboard

A static, GitHub Pages-ready dashboard built from the supplied SCAD Excel workbooks. The application supports dashboards, filtering, record creation and editing, gap ratings, process-completion views, Excel import/export, device-local persistence, and optional shared editing through Google Sheets and Apps Script.

## Ready-to-publish folder

Publish the `docs` folder with GitHub Pages. See `GITHUB-PAGES-GUIDE-AR.md` for the full Arabic deployment and shared-editing guide.

## Local preview

Open `docs/index.html` through a local web server. Direct `file://` opening is not recommended because browsers restrict local file and workbook access.

## Data behavior

- Baseline records are generated from the two supplied Excel files.
- Local edits are stored in the browser and can be exported as updated Excel workbooks.
- Shared edits require the optional Google Apps Script service in `apps-script/Code.gs`.
- Deploying the Apps Script service for `Anyone` gives every visitor with the dashboard URL permission to change the shared records.
