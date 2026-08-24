
# ISU-CAMP Admin Portal

The portal is now a Vite + React + TypeScript application organized by feature modules. It follows the ISU-CAMP Figma administration mockup and uses a seeded asynchronous mock API until a backend is connected.

## Development

```bash
npm install
npm run dev
```

Local development login: `admin_justine` / `password123`. This fixed demo identity is available only when `VITE_API_MODE=local`; mock and production modes authenticate through their configured HTTP backend. Password recovery uses verification code `000000` in the mock adapter.

## Verification

```bash
npm test
npm run build
```

Feature code lives under `src/features`; shared models and replaceable service contracts are in `src/types.ts` and `src/services`.
