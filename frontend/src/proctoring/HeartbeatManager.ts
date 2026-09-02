export class HeartbeatManager {
  private intervalMs: number = 15000 // 15 seconds
  private timerId: ReturnType<typeof setInterval> | null = null
  private sendHeartbeatFn: ((seqNum: number, clientEventId: string) => void) | null = null
  private pendingAcks: Set<number> = new Set()
  private seqCounterRef: { getNext: () => number }

  constructor(seqCounterRef: { getNext: () => number }) {
    this.seqCounterRef = seqCounterRef
  }

  public start(sendHeartbeatFn: (seqNum: number, clientEventId: string) => void) {
    this.stop()
    this.sendHeartbeatFn = sendHeartbeatFn
    this.timerId = setInterval(() => this.tick(), this.intervalMs)
    // Send immediate initial heartbeat
    this.tick()
  }

  public stop() {
    if (this.timerId) {
      clearInterval(this.timerId)
      this.timerId = null
    }
    this.sendHeartbeatFn = null
    this.pendingAcks.clear()
  }

  private tick() {
    if (!this.sendHeartbeatFn) return

    const seqNum = this.seqCounterRef.getNext()
    const clientEventId = `evt_hb_${seqNum}_${Date.now()}`
    this.pendingAcks.add(seqNum)

    try {
      this.sendHeartbeatFn(seqNum, clientEventId)
    } catch (e) {
      console.error('[HeartbeatManager] Failed to send heartbeat:', e)
    }
  }

  public onHeartbeatAck(sequenceNumber: number) {
    this.pendingAcks.delete(sequenceNumber)
  }

  public hasUnacknowledgedHeartbeats(): boolean {
    return this.pendingAcks.size > 0
  }
}
