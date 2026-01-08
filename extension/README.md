# Zone Browser Extension

Browser extension that blocks distracting websites with time limits and accountability.

## Installation

1. Open Chrome/Edge browser
2. Go to `chrome://extensions/` (or `edge://extensions/`)
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `extension` folder

## Setup

1. **Start the backend server** (required):
   ```bash
   cd server
   npm install
   npm run dev
   ```

2. **Configure the extension**:
   - Click the Zone extension icon
   - Set your email address (required for unlock codes)
   - Add websites you want to block with daily time limits

## Features

- ⏱️ **Daily Time Limits** - Set limits for distracting websites
- 📊 **Usage Tracking** - Track time spent on each site
- 🔒 **Automatic Blocking** - Blocks sites when limit is reached
- 🔓 **Unlock System** - Request unlock codes via email
- ☁️ **Cloud Sync** - Rules and usage sync with backend server

## Usage

1. **Add a Rule**:
   - Enter domain (e.g., `youtube.com`)
   - Set daily limit in minutes
   - Click "Add Site"

2. **Blocked Site**:
   - When you reach your daily limit, the site will be blocked
   - Click "Request Unlock Code" to get a temporary unlock
   - Enter the 6-digit code sent to your email
   - Unlock lasts 10 minutes (configurable on backend)

3. **View Usage**:
   - Open the extension popup to see current usage
   - Shows: `used/limit minutes (remaining left)`
   - Colors indicate status:
     - 🟢 Green: Plenty of time left
     - 🟡 Yellow: Less than 20% remaining
     - 🔴 Red: Blocked or at limit

## Requirements

- Backend server must be running on `http://localhost:3033`
- MongoDB must be accessible
- Email configuration (for unlock codes)

## Troubleshooting

**Extension not working?**
- Make sure the backend server is running
- Check browser console for errors (F12)
- Verify MongoDB is connected

**Unlock codes not sending?**
- Make sure you've set your email in the extension popup
- Check backend email configuration in `.env` file
- Check browser console for API errors

**Rules not syncing?**
- Check backend server logs
- Verify UUID is initialized (should happen automatically)
- Try reloading the extension

## API Endpoints Used

- `POST /api/auth/init` - Initialize user
- `POST /api/auth/email` - Update email
- `POST /api/auth/rules` - Update rules
- `POST /api/config` - Get current configuration
- `POST /api/heartbeat` - Track time usage
- `POST /api/unlock/request` - Request unlock code
- `POST /api/unlock/verify` - Verify unlock code
