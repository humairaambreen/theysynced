use utoipa::OpenApi;
use crate::database;

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::health_handler,
        crate::metrics_handler,
    ),
    components(
        schemas(
            database::UserProfile,
            database::Company,
            database::CompanyRole,
            database::CompanyMember,
            database::Team,
            database::WorkspaceAsset,
            database::SearchResult,
        )
    ),
    tags(
        (name = "TheySynced API", description = "Enterprise Office Platform REST & Realtime API")
    )
)]
pub struct ApiDoc;
