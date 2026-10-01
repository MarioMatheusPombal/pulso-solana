use litesvm::LiteSVM;

#[test]
fn program_loads() {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/pulso.so"));
    svm.add_program(pulso::id(), bytes).unwrap();
}
