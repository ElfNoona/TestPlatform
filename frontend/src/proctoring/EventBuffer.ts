import { ProctoringEvent } from './types'

export class EventBuffer {
  private storageKey: string
  private seqStorageKey: string
  private buffer: ProctoringEvent[] = []
  private currentSequenceNumber: number = 0

  constructor(sessionId: string) {
    this.storageKey = `krs_pending_events_${sessionId}`
    this.seqStorageKey = `krs_seq_num_${sessionId}`
    this.loadFromStorage()
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (stored) {
        this.buffer = JSON.parse(stored)
      }

      const storedSeq = localStorage.getItem(this.seqStorageKey)
      if (storedSeq) {
        this.currentSequenceNumber = parseInt(storedSeq, 10) || 0
      }
    } catch (e) {
      console.error('[EventBuffer] Failed to load from storage:', e)
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.buffer))
      localStorage.setItem(this.seqStorageKey, this.currentSequenceNumber.toString())
    } catch (e) {
      console.error('[EventBuffer] Failed to save to storage:', e)
    }
  }

  public getNextSequenceNumber(): number {
    this.currentSequenceNumber += 1
    this.saveToStorage()
    return this.currentSequenceNumber
  }

  public getSequenceNumber(): number {
    return this.currentSequenceNumber
  }

  public addEvent(event: ProctoringEvent) {
    // Prevent duplicates in local buffer
    if (!this.buffer.some((e) => e.clientEventId === event.clientEventId)) {
      this.buffer.push(event)
      this.saveToStorage()
    }
  }

  public ackEvent(clientEventId: string) {
    this.buffer = this.buffer.filter((e) => e.clientEventId !== clientEventId)
    this.saveToStorage()
  }

  public getPendingEvents(): ProctoringEvent[] {
    return [...this.buffer]
  }

  public clear() {
    this.buffer = []
    this.currentSequenceNumber = 0
    try {
      localStorage.removeItem(this.storageKey)
      localStorage.removeItem(this.seqStorageKey)
    } catch (e) {
      /* ignore */
    }
  }
}
