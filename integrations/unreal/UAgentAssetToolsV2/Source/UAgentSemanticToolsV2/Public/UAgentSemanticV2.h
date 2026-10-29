#pragma once
#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "ModelContextProtocolToolResults.h"
namespace UAgentSemanticV2
{
    enum class EQuery : uint8 { Capabilities, Blueprint, World, Selection, References };
    UAGENTSEMANTICTOOLSV2_API FString ToolName(EQuery Query);
    UAGENTSEMANTICTOOLSV2_API TSharedPtr<FJsonObject> Capabilities();
    UAGENTSEMANTICTOOLSV2_API FModelContextProtocolToolResult Invoke(EQuery Query, const TSharedPtr<FJsonObject>& Params);
}
