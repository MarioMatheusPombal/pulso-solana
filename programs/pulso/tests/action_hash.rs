use {
    anchor_lang::prelude::Pubkey,
    pulso::action_hash::{compute_action_hash, ActionFields, PREIMAGE_LEN},
    serde_json::Value,
    std::str::FromStr,
};

const VECTORS: &str = include_str!("../../../tests/vectors/action_hash.json");

fn pk(v: &Value, k: &str) -> Pubkey {
    Pubkey::from_str(v[k].as_str().unwrap()).unwrap()
}

fn fields(v: &Value) -> ActionFields {
    let mut nonce = [0u8; 16];
    nonce.copy_from_slice(&hex(v["nonce"].as_str().unwrap()));
    ActionFields {
        program_id: pk(v, "program_id"),
        instruction: v["instruction"].as_u64().unwrap() as u8,
        authority: pk(v, "authority"),
        agent: pk(v, "agent"),
        mint: pk(v, "mint"),
        amount: v["amount"].as_str().unwrap().parse().unwrap(),
        recipient: pk(v, "recipient"),
        max_uses: v["max_uses"].as_u64().unwrap() as u16,
        nonce,
        expires_at: v["expires_at"].as_str().unwrap().parse().unwrap(),
    }
}

fn hex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn vectors() -> Vec<Value> {
    let root: Value = serde_json::from_str(VECTORS).unwrap();
    assert_eq!(root["preimage_len"].as_u64().unwrap() as usize, PREIMAGE_LEN);
    root["vectors"].as_array().unwrap().clone()
}

#[test]
fn shared_vectors_match() {
    let vs = vectors();
    assert!(vs.len() >= 4);
    for v in &vs {
        let got = compute_action_hash(&fields(v));
        assert_eq!(got.to_vec(), hex(v["hash"].as_str().unwrap()), "vector {}", v["name"]);
    }
}

#[test]
fn changing_any_single_field_changes_hash() {
    let base = fields(&vectors()[0]);
    let h0 = compute_action_hash(&base);
    let other = Pubkey::new_from_array([9; 32]);
    let mutations: Vec<(&str, Box<dyn Fn(&mut ActionFields)>)> = vec![
        ("program_id", Box::new(move |f| f.program_id = other)),
        ("instruction", Box::new(|f| f.instruction = 2)),
        ("authority", Box::new(move |f| f.authority = other)),
        ("agent", Box::new(move |f| f.agent = other)),
        ("mint", Box::new(move |f| f.mint = other)),
        ("amount", Box::new(|f| f.amount += 1)),
        ("recipient", Box::new(move |f| f.recipient = other)),
        ("max_uses", Box::new(|f| f.max_uses += 1)),
        ("nonce", Box::new(|f| f.nonce[15] ^= 1)),
        ("expires_at", Box::new(|f| f.expires_at += 1)),
    ];
    // 10 variable inputs here; domain and chain are constants of the format.
    for (name, m) in mutations {
        let mut f = fields(&vectors()[0]);
        m(&mut f);
        assert_ne!(compute_action_hash(&f), h0, "field {name} not bound by hash");
    }
}
