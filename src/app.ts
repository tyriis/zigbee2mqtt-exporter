import express from "express"
import logger from "morgan"
import WebSocket from "ws"

// Create Express server
export const app = express()

// Express configuration
app.set("port", process.env.PORT || 3000)

app.use(logger("dev"))

app.use("/metrics", (req, res) => {
  const ws = new WebSocket(process.env.ZIGBEE2MQTT_WS || "ws://localhost:8080/api")
  const now = Date.now()
  let devices: string[] = []
  let body: string
  let init: boolean
  let done: boolean
  const deviceData: { [key: string]: number } = {}

  ws.on("error", (err) => {
    // console.log(err.stack);
    if (done !== true) {
      res.sendStatus(500)
    }
  })

  ws.on("close", () => {
    // console.log("close connection");
  })

  ws.on("message", function message(data) {
    if (done) return
    const msg = JSON.parse(data.toString())
    // console.log('received: %s', msg.topic);
    if (msg.topic === "bridge/devices") {
      // collect device names, filter out Coordinator
      devices = msg.payload
        .map((item: { friendly_name: string }) => item.friendly_name)
        .filter((name: string) => name !== "Coordinator")
      init = true
      // console.log(JSON.stringify(devices, null, 4));
    } else if (devices.indexOf(msg.topic) >= 0) {
      // we get some device information now
      deviceData[msg.topic] = new Date(msg.payload.last_seen).getTime()
      // console.log(JSON.stringify(Object.keys(deviceData)));
      // console.log(`${Object.keys(deviceData).length}/${devices.length}`);
    }
    if (init === true && Object.keys(deviceData).length === devices.length) {
      // stop ws
      // console.log(JSON.stringify(deviceData, null, 2));
      ws.close()
      body = `# HELP zigbee2mqtt_last_seen Device last seen in seconds${"\n"}# TYPE zigbee2mqtt_last_seen gauge`

      for (const item in deviceData) {
        body += `${"\n"}zigbee2mqtt_last_seen{device="${item}"} ${(now - deviceData[item]) / 1000}`
      }
      done = true
      res.type("text/plain")
      res.send(body)
    }
  })
})
