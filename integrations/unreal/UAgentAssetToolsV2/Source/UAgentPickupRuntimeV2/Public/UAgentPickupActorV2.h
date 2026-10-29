#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "InputCoreTypes.h"
#include "UAgentPickupActorV2.generated.h"
class USceneComponent;
class UStaticMeshComponent;
class USphereComponent;
class UTextRenderComponent;
class APawn;
class APlayerController;
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FUAgentPickupCollectedV2, FName, ItemId);
/** Fixed single-local-player pickup behavior. Blueprint subclasses configure typed defaults. */
UCLASS(Blueprintable)
class UAGENTPICKUPRUNTIMEV2_API AUAgentPickupActorV2 : public AActor
{
 GENERATED_BODY()
public:
 AUAgentPickupActorV2();
 UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Pickup") TObjectPtr<USceneComponent> PickupRoot;
 UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Pickup") TObjectPtr<UStaticMeshComponent> PickupMesh;
 UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Pickup") TObjectPtr<USphereComponent> InteractionRange;
 UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Pickup") TObjectPtr<UTextRenderComponent> PickupPrompt;
 UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Pickup") FName ItemId = TEXT("Item");
 UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Pickup") FText PromptText;
 UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Pickup", meta=(ClampMin="50", ClampMax="1000", Units="cm")) float InteractionRadiusCm = 200;
 UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Pickup") FKey InteractionKey = EKeys::E;
 UPROPERTY(Transient, BlueprintReadOnly, Category="Pickup|State") bool bCollected = false;
 UPROPERTY(Transient, BlueprintReadOnly, Category="Pickup|State") bool bPlayerNearby = false;
 UPROPERTY(Transient, BlueprintReadOnly, Category="Pickup|State") int32 CollectionCount = 0;
 UPROPERTY(Transient, BlueprintReadOnly, Category="Pickup|State") FString LastInteractionError;
 UPROPERTY(BlueprintAssignable, Category="Pickup") FUAgentPickupCollectedV2 OnCollected;
 UFUNCTION(BlueprintCallable, Category="Pickup") bool TryCollect(APawn* Pawn);
 virtual void Tick(float DeltaSeconds) override;
 virtual void OnConstruction(const FTransform& Transform) override;
protected:
 virtual void BeginPlay() override;
private:
 TWeakObjectPtr<APlayerController> BoundController;
 TWeakObjectPtr<APawn> NearbyPawn;
 void ApplyConfiguration();
 void HandleInteraction();
 void ReleaseInput();
};
