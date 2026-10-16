import type { components } from './schema'

export type Schemas = components['schemas']

// Enums
export type Weekday = Schemas['Weekday']
export type Actor = Schemas['Actor']
export type RoutineDayState = Schemas['RoutineDayState']
export type StickerStatus = Schemas['StickerStatus']
export type StickerSource = Schemas['StickerSource']
export type PrizeRequestStatus = Schemas['PrizeRequestStatus']
export type PrizeCancelReason = Schemas['PrizeCancelReason']
export type DesignStatus = Schemas['DesignStatus']

// Shared
export type DesignRef = Schemas['DesignRefDto']
export type StickerPick = Schemas['StickerPickDto']
export type FieldError = Schemas['FieldErrorDto']
export type ProblemDetail = Schemas['ProblemDetail']

// Family
export type Bootstrap = Schemas['BootstrapDto']
export type ChildSummary = Schemas['ChildSummaryDto']
export type PinSetupRequest = Schemas['PinSetupRequest']
export type PinChangeRequest = Schemas['PinChangeRequest']
export type UnlockRequest = Schemas['UnlockRequest']
export type ParentSession = Schemas['ParentSessionDto']
export type Settings = Schemas['SettingsDto']
export type PinReset = Schemas['PinResetDto']
export type SettingsUpdateRequest = Schemas['SettingsUpdateRequest']

// Children
export type ChildInput = Schemas['ChildInput']
export type Child = Schemas['ChildDto']

// Routines
export type TaskInput = Schemas['TaskInput']
export type RoutineInput = Schemas['RoutineInput']
export type Task = Schemas['TaskDto']
export type Routine = Schemas['RoutineDto']
export type RoutineSaveResult = Schemas['RoutineSaveResultDto']
export type RoutineDeleteResult = Schemas['RoutineDeleteResultDto']
export type RoutineOrderRequest = Schemas['RoutineOrderRequest']
export type RoutineCopyRequest = Schemas['RoutineCopyRequest']

// Chart
export type ChartTask = Schemas['ChartTaskDto']
export type ChartSticker = Schemas['ChartStickerDto']
export type ChartRoutine = Schemas['ChartRoutineDto']
export type UnclaimedSticker = Schemas['UnclaimedStickerDto']
export type DailyChart = Schemas['DailyChartDto']
export type TaskToggleResult = Schemas['TaskToggleResultDto']
export type HistoryRoutine = Schemas['HistoryRoutineDto']
export type HistoryDay = Schemas['HistoryDayDto']
export type History = Schemas['HistoryDto']

// Stickers
export type PickClaimRequest = Schemas['PickClaimRequest']
export type StickerCounts = Schemas['StickerCountsDto']
export type BookSticker = Schemas['BookStickerDto']
export type StickerBookPage = Schemas['StickerBookPageDto']
export type StickerPrize = Schemas['StickerPrizeDto']
export type StickerDetail = Schemas['StickerDetailDto']

// Library
export type DesignInput = Schemas['DesignInput']
export type DesignStatusRequest = Schemas['DesignStatusRequest']
export type Design = Schemas['DesignDto']
export type Library = Schemas['LibraryDto']
export type CategoryInput = Schemas['CategoryInput']
export type Category = Schemas['CategoryDto']

// Prizes
export type PrizeRequestCreateRequest = Schemas['PrizeRequestCreateRequest']
export type PrizeCompleteRequest = Schemas['PrizeCompleteRequest']
export type PrizeEditRequest = Schemas['PrizeEditRequest']
export type PrizeSticker = Schemas['PrizeStickerDto']
export type PrizeRequest = Schemas['PrizeRequestDto']
export type PendingPrizeRequest = Schemas['PendingPrizeRequestDto']
export type PrizeRequestPage = Schemas['PrizeRequestPageDto']

// Revocation
export type Revocation = Schemas['RevocationDto']
export type RevokedSticker = Schemas['RevokedStickerDto']
export type RevokeStickerRequest = Schemas['RevokeStickerRequest']
