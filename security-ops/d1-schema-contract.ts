/** Reviewed fingerprints of sqlite_schema produced by cloudflare/d1/business-schema.sql.
 * Exact SQL bytes, including string literals: no lossy whitespace/case normalization.
 * Formatting-only differences intentionally require review; never learn from a live DB.
 * Synthetic tests compare these fingerprints independently on libSQL and D1.
 */
export const BUSINESS_SCHEMA_CONTRACT = [
  {
    "table": "account",
    "objects": [
      {
        "type": "index",
        "name": "account_userId_idx",
        "sqlSha256": "ca14dbe12480b034ba1d7e9ceb3570802ca7d953e5799e9d951fb0c3f9e489e7"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_account_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "account",
        "sqlSha256": "dab37089aa5f43469c0659dcb1b4935a739cadc428def4b95962dfcc5c6bda24"
      }
    ]
  },
  {
    "table": "audit_event",
    "objects": [
      {
        "type": "index",
        "name": "audit_user_at_idx",
        "sqlSha256": "3be6984885d6bf137b1186639d5c0af79280a40f64fae99c7aa773c508c35903"
      },
      {
        "type": "index",
        "name": "audit_user_seq_uidx",
        "sqlSha256": "080329ab232310e88f20197efec6138d27b2359926aa976afe0b42f462ddddbc"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_audit_event_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "audit_event",
        "sqlSha256": "556727fa47147568a1927ce2b552710306b248f4c8bee7aef1f28684421e11c8"
      }
    ]
  },
  {
    "table": "audit_head",
    "objects": [
      {
        "type": "index",
        "name": "sqlite_autoindex_audit_head_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "audit_head",
        "sqlSha256": "fc3907a533363eefba8904e95b38f3c1fcb0736b0156f1f1dcb6b3ccd6c9b00a"
      }
    ]
  },
  {
    "table": "device",
    "objects": [
      {
        "type": "index",
        "name": "device_user_idx",
        "sqlSha256": "b1f88f0e111b560ebbd4740250ec450aa49052a1c69d7e47bf3e91f1105f3fb5"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_device_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "device",
        "sqlSha256": "977c016cc64fd728dd0ebf6310ab2e0673c690cb24698b6467675002310bb484"
      }
    ]
  },
  {
    "table": "device_session",
    "objects": [
      {
        "type": "index",
        "name": "sqlite_autoindex_device_session_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "device_session",
        "sqlSha256": "f5583a96f1dc10fb104bf5085e59f2d9cd5a3703e7ec90f71e30ed9e3f2cac35"
      }
    ]
  },
  {
    "table": "login_event",
    "objects": [
      {
        "type": "index",
        "name": "login_user_at_idx",
        "sqlSha256": "fe4c8bdf5c9bfa58bf215ad301e9b2941f315b0f04d64eaf4a65ed5e3a74b897"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_login_event_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "login_event",
        "sqlSha256": "0a8faa7b720dcefa548a1b9832fd0fdc0c011bf6e0388227e1dec77c71fae473"
      }
    ]
  },
  {
    "table": "passkey_credential",
    "objects": [
      {
        "type": "index",
        "name": "sqlite_autoindex_passkey_credential_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "passkey_credential",
        "sqlSha256": "51bd5efe70f5bd16f77d0a389b330163dc96b6ff482b5eb9b43324b914051ba6"
      }
    ]
  },
  {
    "table": "rate_limit",
    "objects": [
      {
        "type": "index",
        "name": "rate_limit_key_unique",
        "sqlSha256": "a9b67adb5cd9b834b915f872aaf73cd779aa202cb19f10f84c9c49e609f46244"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_rate_limit_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "rate_limit",
        "sqlSha256": "55543e30dd4cc2250c32c414a6fd7aec27f8d4e947fee6d1a8eb3a4b1a62d226"
      }
    ]
  },
  {
    "table": "record",
    "objects": [
      {
        "type": "index",
        "name": "record_user_seq_idx",
        "sqlSha256": "6135159d3be67bcf4004fbcf342e1da07c3df7ad12c3cbdf0b3600d709c4f7f6"
      },
      {
        "type": "index",
        "name": "record_user_type_idx",
        "sqlSha256": "0114bc8e4d40a9d434742137b634f6fb2ec5b371f3d204446b5d4af62f344420"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_record_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "record",
        "sqlSha256": "93e9d8e5f552e58244d786877368478b883b889bca38859266df3c6d4e4d4a17"
      }
    ]
  },
  {
    "table": "record_revision",
    "objects": [
      {
        "type": "index",
        "name": "revision_user_record_idx",
        "sqlSha256": "b67b0e7efa9092082bc161b0401067e947c2df6d0c6af4ce0ec8816b8e043766"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_record_revision_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "record_revision",
        "sqlSha256": "bd62d1742d58896d10a2c351e46a591d204752372fc46dff18822faeec8a55f3"
      }
    ]
  },
  {
    "table": "security_challenge",
    "objects": [
      {
        "type": "index",
        "name": "sqlite_autoindex_security_challenge_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "security_challenge",
        "sqlSha256": "92f2cac23242af5fd9a07708656f53c0d19b8626d71e6fe07b5a7f5e51914601"
      }
    ]
  },
  {
    "table": "security_counter",
    "objects": [
      {
        "type": "index",
        "name": "sqlite_autoindex_security_counter_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "security_counter",
        "sqlSha256": "ae028c1ac0187e9341e49a226048e999ec77cc1be4fefd83bc899142e26f4174"
      }
    ]
  },
  {
    "table": "session",
    "objects": [
      {
        "type": "index",
        "name": "session_token_unique",
        "sqlSha256": "9467055704a03d0eec4c06ebf6f1b0bf6113ca5bdfb7a64256c371e224d190d1"
      },
      {
        "type": "index",
        "name": "session_userId_idx",
        "sqlSha256": "df82de8ab78b428c67593835d3ef9fcb37c4dc6796ba0f135db84d156b2c6bb0"
      },
      {
        "type": "index",
        "name": "sqlite_autoindex_session_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "session",
        "sqlSha256": "72ace56c1d86b0c21815e193a7055ff31a10cbd0a9067055b8c1da917c3e3611"
      }
    ]
  },
  {
    "table": "step_up_ticket",
    "objects": [
      {
        "type": "index",
        "name": "sqlite_autoindex_step_up_ticket_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "step_up_ticket",
        "sqlSha256": "96bdf3bfa3b2979038852fa2343e1efaffe5cee546c515c7ceed5c5a6b3d49d5"
      }
    ]
  },
  {
    "table": "user",
    "objects": [
      {
        "type": "index",
        "name": "sqlite_autoindex_user_1",
        "sqlSha256": null
      },
      {
        "type": "index",
        "name": "user_email_unique",
        "sqlSha256": "6b3cb127e2c1ccc52c0813d60470e098d1f651163c3181500d7a642d97a068b2"
      },
      {
        "type": "table",
        "name": "user",
        "sqlSha256": "a5c7920a55c8dcac93c8eb7015c585765106f8188898042eddb4936d45ba30e5"
      }
    ]
  },
  {
    "table": "vault",
    "objects": [
      {
        "type": "index",
        "name": "sqlite_autoindex_vault_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "vault",
        "sqlSha256": "06616747e7abff576d5ab52268002331aa54f5410daaae6b1fec98c5e8408a55"
      }
    ]
  },
  {
    "table": "verification",
    "objects": [
      {
        "type": "index",
        "name": "sqlite_autoindex_verification_1",
        "sqlSha256": null
      },
      {
        "type": "index",
        "name": "verification_identifier_idx",
        "sqlSha256": "13f00dd43146fc430ecb7cb119e78c1c6e495d328f3dff31fc08430f8b7f6455"
      },
      {
        "type": "table",
        "name": "verification",
        "sqlSha256": "0505f9e76074679997665250f7a0efd06613e72082f755e49b0ba5502b38a491"
      }
    ]
  },
  {
    "table": "write_identity",
    "objects": [
      {
        "type": "index",
        "name": "sqlite_autoindex_write_identity_1",
        "sqlSha256": null
      },
      {
        "type": "table",
        "name": "write_identity",
        "sqlSha256": "0ccc777e4a36fcfc90898f2143df6a51e52f559f24cdfc03375057b6916f5c70"
      }
    ]
  }
] as const;
