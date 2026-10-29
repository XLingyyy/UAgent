#include "UAgentPickupActorV2.h"
#include "Components/InputComponent.h"
#include "Components/SceneComponent.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "Modules/ModuleManager.h"
AUAgentPickupActorV2::AUAgentPickupActorV2()
{
 PrimaryActorTick.bCanEverTick = true;
 PickupRoot = CreateDefaultSubobject<USceneComponent>(TEXT("PickupRoot")); SetRootComponent(PickupRoot);
 PickupMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("PickupMesh")); PickupMesh->SetupAttachment(PickupRoot); PickupMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision); PickupMesh->SetRelativeScale3D(FVector(0.5));
 InteractionRange = CreateDefaultSubobject<USphereComponent>(TEXT("InteractionRange")); InteractionRange->SetupAttachment(PickupRoot); InteractionRange->SetCollisionEnabled(ECollisionEnabled::QueryOnly); InteractionRange->SetCollisionResponseToAllChannels(ECR_Ignore); InteractionRange->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap); InteractionRange->SetGenerateOverlapEvents(true);
 PickupPrompt = CreateDefaultSubobject<UTextRenderComponent>(TEXT("PickupPrompt")); PickupPrompt->SetupAttachment(PickupRoot); PickupPrompt->SetRelativeLocation(FVector(0,0,80)); PickupPrompt->SetHorizontalAlignment(EHTA_Center); PickupPrompt->SetWorldSize(24); PickupPrompt->SetVisibility(false);
 PromptText = FText::FromString(TEXT("Press E to pick up"));
}
void AUAgentPickupActorV2::ApplyConfiguration()
{
 InteractionRange->SetSphereRadius(InteractionRadiusCm); PickupPrompt->SetText(PromptText);
}
void AUAgentPickupActorV2::OnConstruction(const FTransform& Transform) { Super::OnConstruction(Transform); ApplyConfiguration(); }
void AUAgentPickupActorV2::BeginPlay()
{
 Super::BeginPlay(); ApplyConfiguration(); bCollected = false; bPlayerNearby = false; CollectionCount = 0; PickupPrompt->SetVisibility(false);
 if (!PickupMesh->GetStaticMesh() || !PickupPrompt->Font) LastInteractionError = TEXT("mesh_and_world_text_font_required");
 else if (InteractionRadiusCm < 50 || InteractionRadiusCm > 1000 || (InteractionKey != EKeys::E && InteractionKey != EKeys::F)) LastInteractionError = TEXT("invalid_pickup_configuration");
}
void AUAgentPickupActorV2::ReleaseInput()
{
 if (BoundController.IsValid()) DisableInput(BoundController.Get()); BoundController.Reset(); NearbyPawn.Reset();
}
void AUAgentPickupActorV2::Tick(float DeltaSeconds)
{
 Super::Tick(DeltaSeconds);
 if (bCollected) return;
 if (!PickupMesh->GetStaticMesh() || !PickupPrompt->Font || InteractionRadiusCm < 50 || InteractionRadiusCm > 1000 || (InteractionKey != EKeys::E && InteractionKey != EKeys::F)) { bPlayerNearby = false; PickupPrompt->SetVisibility(false); ReleaseInput(); return; }
 APlayerController* Controller = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
 APawn* Pawn = Controller && Controller->IsLocalController() ? Controller->GetPawn() : nullptr;
 bPlayerNearby = Pawn && Pawn->IsLocallyControlled() && FVector::DistSquared(Pawn->GetActorLocation(), GetActorLocation()) <= FMath::Square(InteractionRadiusCm);
 PickupPrompt->SetVisibility(bPlayerNearby);
 if (!bPlayerNearby) { ReleaseInput(); if (!Pawn) LastInteractionError = TEXT("local_possessed_pawn_required"); return; }
 if (BoundController.Get() != Controller || !InputComponent || !Controller->IsInputComponentInStack(InputComponent))
 {
  ReleaseInput(); EnableInput(Controller); BoundController = Controller;
  if (InputComponent) { InputComponent->KeyBindings.Reset(); auto& Binding = InputComponent->BindKey(InteractionKey, IE_Pressed, this, &AUAgentPickupActorV2::HandleInteraction); Binding.bConsumeInput = false; }
 }
 NearbyPawn = Pawn;
 if (!InputComponent || !Controller->IsInputComponentInStack(InputComponent)) { LastInteractionError = TEXT("pickup_input_component_registration_failed"); return; }
 LastInteractionError.Reset();
 PickupPrompt->SetWorldRotation(Controller->GetControlRotation());
}
void AUAgentPickupActorV2::HandleInteraction() { TryCollect(NearbyPawn.Get()); }
bool AUAgentPickupActorV2::TryCollect(APawn* Pawn)
{
 if (!GetWorld() || !GetWorld()->IsGameWorld()) { LastInteractionError = TEXT("runtime_world_required"); return false; }
 if (bCollected) { LastInteractionError = TEXT("already_collected"); return false; }
 APlayerController* Controller = Pawn ? Cast<APlayerController>(Pawn->GetController()) : nullptr;
 if (!Controller || !Controller->IsLocalController() || Controller->GetPawn() != Pawn || !Pawn->IsLocallyControlled()) { LastInteractionError = TEXT("local_possessed_pawn_required"); return false; }
 if (!PickupMesh->GetStaticMesh() || !PickupPrompt->Font || (InteractionKey != EKeys::E && InteractionKey != EKeys::F) || InteractionRadiusCm < 50 || InteractionRadiusCm > 1000) { LastInteractionError = TEXT("invalid_pickup_configuration"); return false; }
 if (FVector::DistSquared(Pawn->GetActorLocation(), GetActorLocation()) > FMath::Square(InteractionRadiusCm)) { LastInteractionError = TEXT("outside_interaction_radius"); return false; }
 bCollected = true; ++CollectionCount; bPlayerNearby = false; LastInteractionError.Reset();
 PickupPrompt->SetVisibility(false); PickupMesh->SetVisibility(false); SetActorHiddenInGame(true); SetActorEnableCollision(false); ReleaseInput(); OnCollected.Broadcast(ItemId); return true;
}
IMPLEMENT_MODULE(FDefaultModuleImpl, UAgentPickupRuntimeV2);
