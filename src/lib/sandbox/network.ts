import type { NetworkPolicy } from "@vercel/sandbox";

/**
 * Network policies for the demo.
 *
 * Install phase: allow npm registry hosts only.
 * Agent phase: deny-all — the LLM runs on the host via AI Gateway, so the
 * sandbox never needs a Gateway credential or egress while the agent edits/tests.
 *
 * Credential brokering (Gateway header inject) is documented as an alternative
 * if you ever move model calls inside the VM; this demo keeps the key out of
 * the sandbox by calling the model from the Next.js server instead.
 */

/** Domains needed to `npm install` inside the sandbox. */
export const NPM_INSTALL_POLICY: NetworkPolicy = {
  allow: {
    "registry.npmjs.org": [],
    "registry.yarnpkg.com": [],
    "*.npmjs.org": [],
    "nodejs.org": [],
    "*.nodejs.org": [],
  },
};

export const DENY_ALL_POLICY: NetworkPolicy = "deny-all";

/**
 * Optional Gateway-only policy with credential brokering.
 * Not used by the default demo path (model calls stay on the host),
 * but kept as a reference for the "agent inside the VM" alternative.
 */
export function gatewayOnlyPolicy(token: string): NetworkPolicy {
  return {
    allow: {
      "ai-gateway.vercel.sh": [
        {
          transform: [
            { headers: { Authorization: `Bearer ${token}` } },
          ],
        },
      ],
    },
  };
}

export const NETWORK_POLICY_NOTES = [
  "Install phase: networkPolicy allow-list limited to npm registry hosts.",
  "Agent + verify phases: networkPolicy set to deny-all (sandbox has no egress).",
  "LLM calls run on the Next.js host via AI Gateway — AI_GATEWAY_API_KEY / OIDC never enter the sandbox.",
  "Alternative (not used here): Gateway-only allow-list with firewall transform header injection so the VM can call the Gateway without holding the secret.",
];
