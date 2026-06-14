const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:3000']
  : '*';

const io = socketIo(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"]
  }
});

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

// ─── Drone Fleet State ────────────────────────────────────────────────────────
const drones = {
  'drone-1': {
    id: 'drone-1', name: 'Alpha', status: 'flying',
    battery: 87, altitude: 120, speed: 8.5,
    lat: 33.6844, lng: 73.0479,
    signalStrength: 95, temperature: 42,
  },
  'drone-2': {
    id: 'drone-2', name: 'Bravo', status: 'flying',
    battery: 64, altitude: 85, speed: 12.3,
    lat: 33.6900, lng: 73.0550,
    signalStrength: 88, temperature: 38,
  },
  'drone-3': {
    id: 'drone-3', name: 'Charlie', status: 'idle',
    battery: 100, altitude: 0, speed: 0,
    lat: 33.6800, lng: 73.0400,
    signalStrength: 100, temperature: 28,
  },
};

// ─── Alert State ──────────────────────────────────────────────────────────────
const alertHistory = [];
let alertCounter = 0;
const stats = { total: 0, critical: 0, warning: 0, info: 0, success: 0 };

const alertTemplates = [
  { type: 'critical', category: 'battery',     message: (d) => `LOW BATTERY - ${d.name} at ${Math.round(d.battery)}%, return to base immediately` },
  { type: 'warning',  category: 'gps',         message: (d) => `GPS SIGNAL WEAK - ${d.name} locked on ${Math.floor(Math.random() * 3) + 3} satellites` },
  { type: 'critical', category: 'temperature', message: (d) => `HIGH MOTOR TEMP - ${d.name} motor at ${Math.round(d.temperature + Math.random() * 10)}°C` },
  { type: 'info',     category: 'telemetry',   message: (d) => `TELEMETRY UPDATE - ${d.name} at ${Math.round(d.altitude)}m, speed ${d.speed.toFixed(1)}m/s` },
  { type: 'warning',  category: 'wind',        message: (d) => `WIND ALERT - ${d.name} encountering ${Math.floor(Math.random() * 15) + 20}km/h gusts` },
  { type: 'success',  category: 'status',      message: (d) => `SYSTEMS NOMINAL - ${d.name} all subsystems operating within limits` },
  { type: 'critical', category: 'signal',      message: (d) => `RC SIGNAL LOST - ${d.name} entering failsafe hover mode` },
  { type: 'info',     category: 'mission',     message: (d) => `MISSION PROGRESS - ${d.name} waypoint ${Math.floor(Math.random() * 8) + 1} of 10 reached` },
  { type: 'warning',  category: 'compass',     message: (d) => `COMPASS DRIFT - ${d.name} recalibrating magnetic heading` },
  { type: 'success',  category: 'waypoint',    message: (d) => `WAYPOINT REACHED - ${d.name} proceeding to next target` },
  { type: 'info',     category: 'video',       message: (d) => `VIDEO FEED - ${d.name} streaming at 1080p 30fps` },
  { type: 'warning',  category: 'obstacle',    message: (d) => `OBSTACLE DETECTED - ${d.name} proximity sensor triggered at ${Math.floor(Math.random() * 8) + 2}m` },
];

function createAlert(droneId, template) {
  const drone = drones[droneId];
  alertCounter++;
  const alert = {
    id: alertCounter,
    droneId,
    droneName: drone.name,
    type: template.type,
    category: template.category,
    message: template.message(drone),
    timestamp: new Date().toISOString(),
    telemetry: {
      battery: drone.battery,
      altitude: drone.altitude,
      speed: drone.speed,
      lat: drone.lat,
      lng: drone.lng,
      signalStrength: drone.signalStrength,
      temperature: drone.temperature,
    },
    acknowledged: false,
  };

  alertHistory.unshift(alert);
  if (alertHistory.length > 200) alertHistory.pop();

  stats.total++;
  if (stats[alert.type] !== undefined) stats[alert.type]++;

  return alert;
}

function updateDroneTelemetry() {
  Object.values(drones).forEach(drone => {
    if (drone.status === 'flying') {
      drone.battery        = Math.max(5,   drone.battery        - Math.random() * 0.25);
      drone.altitude       = Math.max(10,  Math.min(200, drone.altitude + (Math.random() - 0.5) * 6));
      drone.speed          = Math.max(0,   Math.min(20,  drone.speed    + (Math.random() - 0.5) * 1.5));
      drone.lat           += (Math.random() - 0.5) * 0.001;
      drone.lng           += (Math.random() - 0.5) * 0.001;
      drone.signalStrength = Math.max(40,  Math.min(100, drone.signalStrength + (Math.random() - 0.5) * 4));
      drone.temperature    = Math.max(25,  Math.min(90,  drone.temperature    + (Math.random() - 0.5) * 2));

      if (drone.battery < 20) drone.status = 'returning';
    } else if (drone.status === 'returning') {
      drone.battery  = Math.max(5, drone.battery - 0.1);
      drone.altitude = Math.max(0, drone.altitude - 2);
      drone.speed    = Math.max(0, drone.speed    - 0.4);
      if (drone.altitude <= 0) {
        drone.status = 'landed';
        drone.speed  = 0;
      }
    }
  });
}

// ─── REST Endpoints ───────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    uptime: Math.floor(process.uptime()),
    connections: io.engine.clientsCount,
  });
});

app.get('/api/alerts', (req, res) => {
  const { type, droneId, limit = '50' } = req.query;
  let result = alertHistory;
  if (type)    result = result.filter(a => a.type    === type);
  if (droneId) result = result.filter(a => a.droneId === droneId);
  res.json(result.slice(0, parseInt(limit)));
});

app.get('/api/drones', (req, res) => {
  res.json(Object.values(drones));
});

app.get('/api/stats', (req, res) => {
  res.json({ ...stats, connected: io.engine.clientsCount, uptime: Math.floor(process.uptime()) });
});

app.post('/api/alerts/:id/acknowledge', (req, res) => {
  const alert = alertHistory.find(a => a.id === parseInt(req.params.id));
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  alert.acknowledged = true;
  io.emit('alert_acknowledged', { alertId: alert.id });
  res.json({ success: true });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.emit('connected', {
    message: 'Connected to Drone Command Center',
    drones: Object.values(drones),
    recentAlerts: alertHistory.slice(0, 30),
    stats,
  });

  socket.on('acknowledge_alert', (alertId) => {
    const alert = alertHistory.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      io.emit('alert_acknowledged', { alertId });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ─── Alert Generation Loop (every 3s) ────────────────────────────────────────
setInterval(() => {
  const activeDrones = Object.values(drones).filter(d => d.status !== 'idle');
  if (activeDrones.length === 0) return;

  const drone    = activeDrones[Math.floor(Math.random() * activeDrones.length)];
  const template = alertTemplates[Math.floor(Math.random() * alertTemplates.length)];
  const alert    = createAlert(drone.id, template);

  io.emit('notification', alert);
  io.emit('stats_update', stats);
  console.log(`[${alert.type.toUpperCase()}] ${alert.droneName}: ${alert.message}`);
}, 3000);

// ─── Telemetry Update Loop (every 2s) ────────────────────────────────────────
setInterval(() => {
  updateDroneTelemetry();
  io.emit('drone_update', Object.values(drones));
}, 2000);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`\n🚀 Drone Command Center → http://localhost:${PORT}`);
  console.log(`📡 WebSocket ready | REST API on /api/*\n`);
});
