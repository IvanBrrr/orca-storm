import { translate } from '@/i18n/i18n'
import type { MonitorLane, MonitorReason } from './work-monitor-model'

export function monitorLaneLabel(lane: MonitorLane): string {
  switch (lane) {
    case 'author':
      return translate('workMonitor.author', 'My turn as author')
    case 'reviewer':
      return translate('workMonitor.reviewer', 'My turn as reviewer')
    case 'waiting':
      return translate('workMonitor.waiting', 'Waiting for others or checks')
    case 'working':
      return translate('workMonitor.working', 'In progress')
    case 'finish':
      return translate('workMonitor.finish', 'Ready to finish')
    case 'unknown':
      return translate('workMonitor.unknown', 'Next turn unclear')
  }
}

export function monitorReasonLabel(reason: MonitorReason): string {
  switch (reason) {
    case 'changes':
      return translate('workMonitor.changes', 'Address requested changes')
    case 'checks':
      return translate('workMonitor.checks', 'Fix failed checks')
    case 'conflict':
      return translate('workMonitor.conflict', 'Resolve merge conflicts')
    case 'review':
      return translate('workMonitor.review', 'Review requested')
    case 'draft':
      return translate('workMonitor.draft', 'Continue draft pull request')
    case 'merge':
      return translate('workMonitor.merge', 'Ready to merge')
    case 'close':
      return translate('workMonitor.close', 'PR merged · check completion in Plane')
    case 'working':
      return translate('workMonitor.taskWorking', 'Plane: in progress · no linked PR loaded')
    case 'assigned':
      return translate('workMonitor.assigned', 'Assigned task')
    case 'reviewRoutingUnknown':
      return translate('workMonitor.reviewRoutingUnknown', 'Next reviewer not confirmed')
    case 'mergeBlocked':
      return translate('workMonitor.mergeBlocked', 'Approved · merge readiness not confirmed')
    case 'unknown':
      return translate('workMonitor.missingState', 'Review state unavailable')
  }
}
