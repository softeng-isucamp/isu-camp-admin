
# ISU-CAMP Admin Portal

The portal is now a Vite + React + TypeScript application organized by feature modules. It follows the ISU-CAMP Figma administration mockup and uses a seeded asynchronous mock API until a backend is connected.

## Development

```bash
npm install
npm run dev
```

Demo login: `admin_justine` with any non-empty password. Password recovery uses verification code `000000` in the mock adapter.

## Verification

```bash
npm test
npm run build
```

Feature code lives under `src/features`; shared models and replaceable service contracts are in `src/types.ts` and `src/services`.
