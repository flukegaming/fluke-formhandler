<?php
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: https://flukegaming.com');
    header('Access-Control-Allow-Origin: https://test.flukegaming.com');
    header('Access-Control-Allow-Methods: POST');
    header('Access-Control-Allow-Headers: Content-Type');

    // Handle preflight
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(200);
        exit();
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        
        if (!$data) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid data']);
            exit;
        }
        
        // TODO: Append to your Google Sheet via API, save to Azure Table Storage, or email
        // For now, just echo success
        echo json_encode([
            'success' => true, 
            'message' => 'Raid signup received!',
            'data' => $data
        ]);
    } else {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    }
?>
