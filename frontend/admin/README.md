
# ISU-CAMP Admin Portal

The portal is now a Vite + React + TypeScript application organized by feature modules. It follows the ISU-CAMP Figma administration mockup and uses the authenticated HTTP backend.

## Development

```bash
npm install
npm run dev
```

The frontend connects to the real backend at `http://127.0.0.1:5000` by default. Set `VITE_API_BASE_URL` when using another backend address. The backend must be running before starting the frontend.

## Verification

```bash
npm test
npm run build
```

Feature code lives under `src/features`; shared models and replaceable service contracts are in `src/types.ts` and `src/services`.
