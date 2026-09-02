async function run() {
  try {
    const res = await fetch('http://grading-service:6000/health');
    const text = await res.text();
    console.log('SUCCESS:', text);
  } catch (err) {
    console.error('FETCH ERROR:', err);
    console.error('CAUSE:', err.cause);
    console.error('CODE:', err.code);
  }
}
run();
