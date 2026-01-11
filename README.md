# Zone - Website Time Tracker & Blocker

<div align="center">

<img src="extension/icons/logo.png" alt="Zone Logo" width="200"/>

**A Chrome extension that helps you stay focused by tracking and limiting time spent on distracting websites.**

</div>

## ✨ Features

- 🕐 **Time Tracking** - Automatically tracks time spent on specified websites
- 🚫 **Smart Blocking** - Blocks sites when daily limits are reached
- 📱 **SPA Support** - Works with Single Page Applications like YouTube
- 📊 **Real-time Stats** - View usage statistics in the popup
- 🔄 **Background Sync** - Syncs data across browser sessions
- ⚡ **Instant Response** - Blocks sites within seconds of limit being reached
- 🎨 **Beautiful UI** - Modern, minimal design with gradient effects
- ⏱️ **Live Counter** - Real-time countdown showing remaining time

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18.0.0 or higher
- **MongoDB** (local or cloud)
- **Chrome Browser** (or Chromium-based)

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/zone.git
cd zone
```

### 2. Backend Setup

```bash
cd server
npm install
```

Create a `.env` file in the `server` directory:

```env
NODE_ENV=development
PORT=3033
MONGO_URI=mongodb://localhost:27017/zone
```

**Note:** Email configuration is no longer needed as the unlock feature has been removed.
```

Start the server:

```bash
npm run dev
```

You should see:
```
✅ Zone server running on port 3033 (development mode)
```

### 3. Extension Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension` folder from this project

### 4. Configuration

1. Click the Zone extension icon in your browser toolbar
2. Add websites with daily time limits:
   - **Site**: `youtube.com`
   - **Minutes**: `30` (or your preferred limit)
   - Click **Add Site**
3. Start browsing - the extension will track your time automatically!

## 📖 How It Works

```
User visits tracked site → Background script starts timer → Heartbeat sent every 30s
                                                                      ↓
Server updates usedToday ← Content script blocks page ← Limit exceeded?
```

1. **Background Script** - Tracks active tabs and sends usage data to the server
2. **Content Script** - Monitors pages and displays blocking overlay when limits are reached
3. **Server API** - Stores usage data and calculates blocking status
4. **Popup Interface** - Manages rules and displays real-time statistics

## 🛠️ Development

### Project Structure

```
zone/
├── extension/           # Chrome extension files
│   ├── manifest.json   # Extension manifest
│   ├── background.js   # Service worker for time tracking
│   ├── contentScript.js # Page blocking logic
│   ├── popup.html      # Extension popup UI
│   └── popup.js        # Popup functionality
├── server/             # Backend API
│   ├── routes/         # API endpoints
│   ├── models/         # MongoDB schemas
│   ├── middleware/     # Express middleware
│   └── server.js       # Main server file
└── docs/               # Documentation
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/init` | POST | Initialize user |
| `/api/config` | POST | Get user rules and blocking status |
| `/api/heartbeat` | POST | Track time spent on sites |

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URI` | ✅ | - | MongoDB connection string |
| `NODE_ENV` | ❌ | `development` | Environment mode |
| `PORT` | ❌ | `3033` | Server port |


### Manual Testing

1. **Set a short limit** (1 minute) for quick testing
2. **Visit the tracked site** and wait
3. **Check console logs** for `[Zone]` messages
4. **Verify blocking** when limit is reached

## 🚨 Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Extension not loading | Check that you selected the `extension` folder, not root |
| Server won't start | Verify MongoDB is running and `MONGO_URI` is correct |
| Time not tracking | Check background script console in `chrome://extensions/` |
| Sites not blocking | Run `test-blocking.js` to verify blocking mechanism |
| Rate limiting errors | Reduce API call frequency or check server logs |



### Environment Setup

For production, ensure:
- MongoDB is accessible and secured
- CORS origins are properly set
- Rate limiting is configured appropriately
- Environment variables are properly configured

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines

- Follow existing code style and conventions
- Add tests for new functionality
- Update documentation as needed
- Ensure all tests pass before submitting



**[⭐ Star this repo](https://github.com/hassarch/zone)** if you find it helpful!

Made with ❤️ for productivity and focus

</div>