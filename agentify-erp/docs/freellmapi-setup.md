# FreeLLMAPI on the server (simple guide)

FreeLLMAPI is a small program that sits next to Agentify ERP on the same server. It collects the free tiers of many AI companies behind one address. Agentify talks to it only from inside the server, so nobody on the internet can reach it.

What Agentify uses it for, and what it never replaces:

* **Ask**: help and walkthrough questions that hold no workspace data, and a last backup when Groq, Stable Horde and Gemini fail. Your existing engine order is not changed.
* **Images** (Creative Studio): a backup when Gemini cannot make the picture. Free pictures cost the workspace no credits.
* **Speech**: a backup only. Azure Speech stays the main voice.
* **Video**: a test button in the console for now.
* **Workspace data** (leads, clients, payments, notes, records) goes to it only for a workspace you switched on yourself, and never when the emergency switch is on.

## 1. Install with Docker on the same server

Log in to the server over SSH, then:

```bash
sudo mkdir -p /opt/freellmapi && cd /opt/freellmapi
sudo git clone https://github.com/asadrealestatewala/freellmapi.git .
sudo cp .env.example .env 2>/dev/null || sudo touch .env
sudo docker compose up -d
sudo docker compose ps          # state should say "healthy" after about 30 seconds
```

If Docker is not installed: `curl -fsSL https://get.docker.com | sudo sh`.

## 2. Keep it private (localhost only)

The compose file already publishes the port as `127.0.0.1:3001`, which means only programs on the server itself can reach it. Check it:

```bash
sudo ss -ltnp | grep 3001       # must show 127.0.0.1:3001, never 0.0.0.0:3001
```

Do not set `HOST_BIND=0.0.0.0` in `.env`, do not open port 3001 in the firewall, and do not put it behind your website's address.

## 3. Open the dashboard safely (SSH tunnel)

On your own computer:

```bash
ssh -L 3001:127.0.0.1:3001 <your-user>@<your-server-ip>
```

Leave that window open, then open **http://localhost:3001** in your browser. Create the dashboard password the first time. Close the SSH window when you are finished and the dashboard disappears again.

## 4. Add free provider keys

In the dashboard open **Keys** and paste a free key from each provider you have an account with (for example Google AI Studio, Groq, Cerebras, OpenRouter, Mistral). More keys means more free capacity. Open **Models** and switch on the image, video and audio models you want. Then copy the **unified API key** (it starts with `freellmapi-`).

## 5. Connect Agentify

Best way: console > Reports & Analytics > AI > **FreeLLMAPI** card. Paste the unified key (it is saved encrypted and never shown again), tick **Use FreeLLMAPI**, press **Save**, then **Test the connection**. Use **Make a test image** to see it work.

Alternative: put these in `server/.env` on the server and restart Agentify. The console values win when they are filled in.

```
FREELLMAPI_ENABLED=1
FREELLMAPI_BASE_URL=http://localhost:3001/v1
FREELLMAPI_API_KEY=freellmapi-xxxxxxxx
```

If Agentify itself runs inside Docker, `localhost` means the Agentify container, not the server. Then use `http://host.docker.internal:3001/v1` and add `extra_hosts: ["host.docker.internal:host-gateway"]` to Agentify's compose file.

## 6. Switches in the console

* **Use FreeLLMAPI**: master on/off. Off means it is never called.
* **Chat, Images, Video, Speech**: one switch each.
* **Allow workspace data through FreeLLMAPI**: per workspace, off by default. Turning it on shows a warning and needs a confirm tick. The audit log records who and when, and the workspace's admin sees a notice in Settings > System settings > Ask assistant.
* **Emergency off for ALL workspaces**: overrides every workspace switch immediately.

## 7. If something looks wrong

* The card says it cannot connect: `sudo docker compose -f /opt/freellmapi/docker-compose.yml ps` and `logs --tail 50`.
* People see "The extra AI helper is busy or not available right now": Ask moves on to its other engines or the help-guide text. Nothing else breaks.
* Every call is in the AI usage list with provider `freellmapi`, the model that answered (from the `X-Routed-Via` header) and a cost of 0.
* To stop everything at once: untick **Use FreeLLMAPI**.

## Updating

```bash
cd /opt/freellmapi && sudo git pull && sudo docker compose up -d --build
```

Free providers change their limits often, so check the dashboard now and then.

## Automatic install on deploy

`.github/scripts/remote-bootstrap.sh` runs `install_freellmapi` on every deploy. It installs Docker only if missing, clones the FreeLLMAPI fork to `/opt/freellmapi`, starts it with `HOST_BIND=127.0.0.1`, and does nothing when it already runs. Any failure is printed and ignored, so a deploy never stops because of it. The deploy log tells you the result ("freellmapi running on 127.0.0.1:3001"). You still do steps 3 to 5 yourself (open the dashboard through the SSH tunnel, set its password, add provider keys, paste the unified key into the console card).

## Fully automatic first run

After FreeLLMAPI starts, the deploy also runs `configure_freellmapi`:

* claims the dashboard from inside the container with a random password, kept only in `/opt/freellmapi/dashboard-login.txt` (root only, never in the log). Read it with `sudo cat /opt/freellmapi/dashboard-login.txt` when you open the dashboard through the SSH tunnel;
* adds the providers that need no key (Kilo gateway, OVH AI Endpoints, AI Horde), so chat works at once. These free services may log prompts, which is why workspace data stays off unless you allow it per workspace;
* writes `FREELLMAPI_API_KEY`, `FREELLMAPI_BASE_URL=http://127.0.0.1:3001/v1` and `FREELLMAPI_ENABLED=1` into `server/.env` (other lines are kept).

Images and video need provider keys (for example Pollinations, Cloudflare, Hugging Face); add them in the dashboard when you want them. Until then Creative Studio keeps using Gemini. To switch FreeLLMAPI off at any time, untick "Use FreeLLMAPI" in the console card (the console setting wins over `.env`).
