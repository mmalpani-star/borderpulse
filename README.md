# BorderPulse

Zero-touch cross-border dispatch console for the cOmpiled-16 hackathon (No-App track). It forecasts commercial border
congestion across four ports (Otay Mesa, Tecate, Calexico East, San Luis), compares door-to-door trip time against the
best alternative, and recommends a dispatch decision. It then places a **real outbound voice call through Vapi**, so
the driver can confirm by voice without touching the phone.

> **The border data is simulated.** Wait times, drive times, port hours, bottlenecks, the driver persona, the load and the
> customs-manifest update are fictional values from a deterministic model (`src/lib/sim.ts`). The only real-world action is
> the Vapi phone call in Live mode.

## Run

```bash
npm install
cp .env.example .env.local   # then fill in the Vapi values
npm run dev                  # http://localhost:3000
npm test                     # decision engine, zero-touch state machine, Vapi helpers
```

### Vapi setup

| Variable | Value |
|---|---|
| `VAPI_API_KEY` | Your Vapi **private** API key |
| `VAPI_ASSISTANT_ID` | The assistant that speaks to the driver |
| `VAPI_PHONE_NUMBER_ID` | The Vapi phone number to call from |
| `DRIVER_PHONE_NUMBER` | The driver's phone, E.164 (the only number a call can ring) |

The console sends the locked decision to the assistant as template variables you can use in its first message or prompt:
`{{broadcast}}` (the full script), `{{headline}}`, `{{primaryPort}}`, `{{primaryWait}}`, `{{recommendedPort}}`,
`{{recommendedWait}}`, `{{savings}}`, `{{eta}}`, `{{driverName}}`, `{{unit}}`, `{{loadId}}`. Tell the assistant to ask the
driver to say **"Confirm"**. The console polls the call and marks it confirmed when the driver's side of the transcript
contains "confirm".

Zero-touch assumes **auto-answer** is enabled on the driver's phone or Bluetooth headset. Vapi places a standard phone call.

## Demo script (about 2 minutes)

1. **Primary route** selector: choose the route the load is booked on. The default is Otay Mesa at 1:40 PM with
   *Simulate bottleneck* on, which gives **Divert to Tecate** and saves about 2h door to door.
2. Hover the four-port forecast chart, or check the all-ports table under the comparison.
3. Press **Dispatch & call driver · LIVE**. The event log runs hands-free:
   1. *Bottleneck detected.* (SIMULATED)
   2. *Auto-broadcast sent directly to driver's Bluetooth headset.* (LIVE, with the Vapi call id)
   3. *Verbal 'Confirm' received from driver.* (LIVE, detected in the transcript)
   4. *Customs manifest updated automatically.* (SIMULATED; no customs system is connected)
4. Advance the load: en route, at port, crossed, delivered.

Every log line carries a source badge (LIVE / SIMULATED / DISPATCHER). If the Vapi call fails, for example because of
missing keys or a network problem, the console logs the reason and continues with a labeled **simulated** broadcast.

## Data sources

The header toggle switches between two sources of wait times:

- **Deterministic Model** (default): simulated waits from `src/lib/sim.ts`. Use the departure slider and bottleneck toggle
  to test scenarios.
- **CBP Live Telemetry**: real commercial-lane delays from U.S. CBP's public Border Wait Times feed
  (`https://bwt.cbp.gov/api/bwtnew`), refreshed every 60 s. Departure is "now" (Pacific time). Each port's current delay
  is used as its wait at arrival, because CBP publishes no forecast. Ports reporting "Lanes Closed", "Update Pending" or
  no figure are treated as unavailable. A primary-port delay of 60 min or more logs a LIVE "Bottleneck detected."

CBP commercial crossings used: Otay Mesa **250602**, Tecate **250501**, Calexico East **250301**, San Luis II **260802**.
CBP stamps San Luis in its own local clock, so its hours are converted to Pacific time.

If CBP is unreachable or rate-limited, `/api/cbp` returns model readings labeled `source: "model"`, and the header shows
"CBP unreachable · model fallback". Set `CBP_FEED_URL` to point at a mirror or a saved snapshot for offline demos.

## API

- `GET /api/cbp` returns live CBP readings for the four ports, cached for 60 s (`Cache-Control: s-maxage=60`).

- `POST /api/dispatch` places the Vapi call to `DRIVER_PHONE_NUMBER`. It has a 20 s cooldown against double-clicks.
- `GET /api/dispatch` reports whether Vapi is configured. It never returns secrets.
- `GET /api/dispatch?id=<callId>` returns the call status and whether the driver said "Confirm".

The endpoint has no authentication. Don't leave a deployed URL public with live keys configured.

## Layout

```
src/lib/sim.ts               four-port simulation + decision engine
src/lib/dispatch.ts          zero-touch dispatch state machine, broadcast script, Vapi variables
src/lib/vapi.ts              transcript parsing + input sanitizing (pure, unit-tested)
src/app/api/dispatch/        Vapi outbound call + status
src/components/              dashboard UI
tests/logic.test.ts          unit tests (node --test)
```
