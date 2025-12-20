# Route Receiver

Simple Express receiver to accept route POSTs from the dashboard for testing.

Run:

```bash
cd receiver
npm install
npm start
```

Test with Node (Node 18+):

```bash
node receiver/test-post.mjs
```

Or configure `VITE_MOBILE_APP_URL` in the dashboard to point to `http://<pc-ip>:4000/receive` and use the dashboard's dispatch.
