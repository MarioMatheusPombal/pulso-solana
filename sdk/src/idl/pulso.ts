/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/pulso.json`.
 */
export type Pulso = {
  "address": "4jdHys9YsHTbVQxB6YAr7R8jsmoEy7wqcpxC9tk2dqQi",
  "metadata": {
    "name": "pulso",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "PULSO: programmable human authorization for autonomous agents. NOT AUDITED. DEVNET DEMONSTRATION ONLY."
  },
  "instructions": [
    {
      "name": "approveRecipient",
      "discriminator": [
        2,
        156,
        214,
        207,
        168,
        101,
        119,
        160
      ],
      "accounts": [
        {
          "name": "human",
          "docs": [
            "Must be the policy's human; the agent can never allowlist a destination itself."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "policy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.human",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.agent",
                "account": "agentPolicy"
              }
            ]
          }
        },
        {
          "name": "recipient",
          "docs": [
            "Destination token account being allowlisted (read only)."
          ]
        },
        {
          "name": "recipientApproval",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  105,
                  112,
                  105,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "recipient"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createPolicy",
      "discriminator": [
        27,
        81,
        33,
        27,
        196,
        103,
        246,
        53
      ],
      "accounts": [
        {
          "name": "human",
          "writable": true,
          "signer": true
        },
        {
          "name": "agent"
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "human"
              },
              {
                "kind": "account",
                "path": "agent"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "maxPerTransaction",
          "type": "u64"
        },
        {
          "name": "dailyLimit",
          "type": "u64"
        },
        {
          "name": "requireApprovalForNewRecipient",
          "type": "bool"
        },
        {
          "name": "requireApprovalAbove",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createVault",
      "discriminator": [
        29,
        237,
        247,
        208,
        193,
        82,
        54,
        135
      ],
      "accounts": [
        {
          "name": "human",
          "docs": [
            "Must be the policy's human; pays for the vault account."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "policy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.human",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.agent",
                "account": "agentPolicy"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vault",
          "docs": [
            "Token account whose authority is the policy PDA: only this program can",
            "sign for it, so funds move only through instructions that check policy."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executeTransfer",
      "discriminator": [
        233,
        126,
        160,
        184,
        235,
        206,
        31,
        119
      ],
      "accounts": [
        {
          "name": "agent",
          "signer": true
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.human",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.agent",
                "account": "agentPolicy"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              }
            ]
          }
        },
        {
          "name": "recipient",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "intent",
          "docs": [
            "Optional human approval. Typed and program-owned; it is bound to this action by the",
            "recomputed action hash (not by seeds), so tampering returns a PULSO error code."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "recipientApproval",
          "docs": [
            "Optional allowlist entry for `recipient`, created only by the human via `approve_recipient`."
          ],
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  105,
                  112,
                  105,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "recipient"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "nonce",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        }
      ]
    },
    {
      "name": "recordIntent",
      "discriminator": [
        50,
        227,
        41,
        124,
        202,
        96,
        159,
        213
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Must be the policy's human; pays for the intent account."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "policy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.human",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.agent",
                "account": "agentPolicy"
              }
            ]
          }
        },
        {
          "name": "intent",
          "docs": [
            "One intent per (authority, action_hash): `init` rejects duplicates."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  116,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "arg",
                "path": "actionHash"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "actionHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "expiresAt",
          "type": "i64"
        },
        {
          "name": "maxUses",
          "type": "u16"
        }
      ]
    },
    {
      "name": "revokeAgent",
      "discriminator": [
        227,
        60,
        209,
        125,
        240,
        117,
        163,
        73
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Must be the policy's human. The agent can never revoke or un-revoke itself."
          ],
          "signer": true
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.human",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.agent",
                "account": "agentPolicy"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "revokeIntent",
      "discriminator": [
        42,
        248,
        79,
        132,
        107,
        96,
        193,
        153
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Must be the human who issued the intent."
          ],
          "signer": true
        },
        {
          "name": "intent",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "updatePolicy",
      "discriminator": [
        212,
        245,
        246,
        7,
        163,
        151,
        18,
        57
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Must be the policy's human. The agent can never change its own policy."
          ],
          "signer": true
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.human",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.agent",
                "account": "agentPolicy"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "enabled",
          "type": "bool"
        },
        {
          "name": "maxPerTransaction",
          "type": "u64"
        },
        {
          "name": "dailyLimit",
          "type": "u64"
        },
        {
          "name": "requireApprovalForNewRecipient",
          "type": "bool"
        },
        {
          "name": "requireApprovalAbove",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "agentPolicy",
      "discriminator": [
        148,
        193,
        218,
        129,
        21,
        96,
        195,
        77
      ]
    },
    {
      "name": "intentAuthorization",
      "discriminator": [
        150,
        220,
        148,
        182,
        20,
        199,
        128,
        11
      ]
    },
    {
      "name": "recipientApproval",
      "discriminator": [
        115,
        88,
        118,
        206,
        214,
        99,
        119,
        85
      ]
    }
  ],
  "events": [
    {
      "name": "agentRevoked",
      "discriminator": [
        12,
        251,
        249,
        166,
        122,
        83,
        162,
        116
      ]
    },
    {
      "name": "intentRecorded",
      "discriminator": [
        13,
        149,
        226,
        220,
        193,
        191,
        124,
        160
      ]
    },
    {
      "name": "intentRequired",
      "discriminator": [
        202,
        112,
        212,
        131,
        41,
        59,
        66,
        33
      ]
    },
    {
      "name": "intentRevocation",
      "discriminator": [
        249,
        149,
        70,
        34,
        103,
        81,
        25,
        132
      ]
    },
    {
      "name": "policyCreated",
      "discriminator": [
        59,
        189,
        65,
        121,
        86,
        157,
        108,
        10
      ]
    },
    {
      "name": "policyUpdated",
      "discriminator": [
        225,
        112,
        112,
        67,
        95,
        236,
        245,
        161
      ]
    },
    {
      "name": "recipientApproved",
      "discriminator": [
        236,
        14,
        9,
        83,
        183,
        76,
        187,
        214
      ]
    },
    {
      "name": "transferExecuted",
      "discriminator": [
        8,
        128,
        224,
        132,
        112,
        216,
        192,
        35
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "policyNotFound",
      "msg": "PULSO_001_POLICY_NOT_FOUND"
    },
    {
      "code": 6001,
      "name": "policyDisabled",
      "msg": "PULSO_002_POLICY_DISABLED"
    },
    {
      "code": 6002,
      "name": "humanIntentRequired",
      "msg": "PULSO_003_HUMAN_INTENT_REQUIRED"
    },
    {
      "code": 6003,
      "name": "intentExpired",
      "msg": "PULSO_004_INTENT_EXPIRED"
    },
    {
      "code": 6004,
      "name": "intentAlreadyUsed",
      "msg": "PULSO_005_INTENT_ALREADY_USED"
    },
    {
      "code": 6005,
      "name": "intentMismatch",
      "msg": "PULSO_006_INTENT_MISMATCH"
    },
    {
      "code": 6006,
      "name": "recipientNotAllowed",
      "msg": "PULSO_007_RECIPIENT_NOT_ALLOWED"
    },
    {
      "code": 6007,
      "name": "amountExceedsLimit",
      "msg": "PULSO_008_AMOUNT_EXCEEDS_LIMIT"
    },
    {
      "code": 6008,
      "name": "dailyLimitExceeded",
      "msg": "PULSO_009_DAILY_LIMIT_EXCEEDED"
    },
    {
      "code": 6009,
      "name": "unauthorizedAgent",
      "msg": "PULSO_010_UNAUTHORIZED_AGENT"
    },
    {
      "code": 6010,
      "name": "policyChangeForbidden",
      "msg": "PULSO_011_POLICY_CHANGE_FORBIDDEN"
    },
    {
      "code": 6011,
      "name": "invalidPolicyLimits",
      "msg": "Invalid policy limits"
    },
    {
      "code": 6012,
      "name": "invalidIntent",
      "msg": "Invalid intent: expires_at must be in the future and max_uses > 0"
    },
    {
      "code": 6013,
      "name": "intentRevoked",
      "msg": "Intent revoked"
    }
  ],
  "types": [
    {
      "name": "agentPolicy",
      "docs": [
        "Limits that define an agent's autonomy. Seeds: [\"policy\", human, agent]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "human",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "maxPerTransaction",
            "type": "u64"
          },
          {
            "name": "dailyLimit",
            "type": "u64"
          },
          {
            "name": "requireApprovalForNewRecipient",
            "type": "bool"
          },
          {
            "name": "requireApprovalAbove",
            "type": "u64"
          },
          {
            "name": "policyVersion",
            "type": "u32"
          },
          {
            "name": "spentInWindow",
            "docs": [
              "Daily-limit counter (used by spend enforcement); kept here to avoid a later account migration."
            ],
            "type": "u64"
          },
          {
            "name": "windowStart",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "agentRevoked",
            "docs": [
              "Permanent revocation of the agent; only `revoke_agent` sets it and nothing clears it."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "agentRevoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "human",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "intentAuthorization",
      "docs": [
        "Proof that the human authorized one exact action. Seeds: [\"intent\", authority, action_hash]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "actionHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "issuedAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "maxUses",
            "type": "u16"
          },
          {
            "name": "usedCount",
            "type": "u16"
          },
          {
            "name": "revoked",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "intentRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "intent",
            "type": "pubkey"
          },
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "actionHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "maxUses",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "intentRequired",
      "docs": [
        "Emitted right before `HumanIntentRequired` is returned. An Anchor error carries no data,",
        "so clients read this from the logs of the failed transaction (or of a simulation) to",
        "build the approval request. Pubkeys and numbers only."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "human",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "requireApprovalAbove",
            "type": "u64"
          },
          {
            "name": "policyVersion",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "intentRevocation",
      "docs": [
        "Named `IntentRevocation` because `IntentRevoked` is already the error variant."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "intent",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "policyCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "human",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "maxPerTransaction",
            "type": "u64"
          },
          {
            "name": "dailyLimit",
            "type": "u64"
          },
          {
            "name": "requireApprovalForNewRecipient",
            "type": "bool"
          },
          {
            "name": "requireApprovalAbove",
            "type": "u64"
          },
          {
            "name": "policyVersion",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "policyUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "human",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "maxPerTransaction",
            "type": "u64"
          },
          {
            "name": "dailyLimit",
            "type": "u64"
          },
          {
            "name": "requireApprovalForNewRecipient",
            "type": "bool"
          },
          {
            "name": "requireApprovalAbove",
            "type": "u64"
          },
          {
            "name": "policyVersion",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "recipientApproval",
      "docs": [
        "Human-approved destination. `recipient` is the destination token account address.",
        "Seeds: [\"recipient\", policy, recipient]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "recipientApproved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "transferExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "spentInWindow",
            "type": "u64"
          },
          {
            "name": "intent",
            "type": {
              "option": "pubkey"
            }
          }
        ]
      }
    }
  ]
};
