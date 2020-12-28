/////////////////////////////////////////////////////////////////////
// Copyright (c) Autodesk, Inc. All rights reserved
// Written by Forge Partner Development
//
// Permission to use, copy, modify, and distribute this software in
// object code form for any purpose and without fee is hereby granted,
// provided that the above copyright notice appears in all copies and
// that both that copyright notice and the limited warranty and
// restricted rights notice below appear in all supporting
// documentation.
//
// AUTODESK PROVIDES THIS PROGRAM "AS IS" AND WITH ALL FAULTS.
// AUTODESK SPECIFICALLY DISCLAIMS ANY IMPLIED WARRANTY OF
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR USE.  AUTODESK, INC.
// DOES NOT WARRANT THAT THE OPERATION OF THE PROGRAM WILL BE
// UNINTERRUPTED OR ERROR FREE.
/////////////////////////////////////////////////////////////////////
'use strict';   

const express = require('express');
const bodyParser=require('body-parser');
const { designAutomation }= require('../config');
const { OAuth } = require('./common/oauthImp');
const { Utils } = require('./common/da4rimp');

const SOCKET_TOPIC_WORKITEM = 'Workitem-Notification';
var workitemList = [];

const router = express.Router();
const jsonParser = bodyParser.json();


///////////////////////////////////////////////////////////////////////
/// Middleware for obtaining a token for each request.
///////////////////////////////////////////////////////////////////////
router.use(async (req, res, next) => {
    const oauth = new OAuth(req.session);
    let credentials = await oauth.getInternalToken();
    let oauth_client = oauth.getClient();

    req.oauth_client = oauth_client;
    req.oauth_token = credentials;
    next();
});



///////////////////////////////////////////////////////////////////////
/// Export Qto info to Json file from Revit
///////////////////////////////////////////////////////////////////////
router.get('/da4revit/revit/:version_storage/assets', async (req, res, next) => {
    const inputJson = req.query;
    const inputRvtUrl = (req.params.version_storage);
    if (inputJson === '' || inputRvtUrl === '') {
        res.status(400).end('make sure the input version id has correct value');
        return;
    }
    const inputFileArgument = {
        url: inputRvtUrl,
        Headers: {
            Authorization: `Bearer ${req.oauth_token.access_token}`
        },
    };
    const outputJsonArgument = {
        verb: 'put',
        Headers: {
            'Content-Type': 'application/json'
        },
        url: `${designAutomation.app_base_domain}/api/forge/da4revit/file`
    };
    const workItemSpec = {
        activityId: `${Utils.NickName}.${Utils.ActivityName}+${Utils.Alias}`,
        arguments: {
            inputFile: inputFileArgument,
            inputJson: {url: "data:application/json,"+ JSON.stringify(inputJson)},
            outputJson: outputJsonArgument,
            onComplete: {
                verb: 'post',
                url: `${designAutomation.app_base_domain}/api/forge/callback/designautomation`
            }
        }
    };
    // use 2 legged token for design automation
    const oauth = new OAuth(req.session);
    const oauth_client = oauth.get2LeggedClient();;
    const oauth_token = await oauth_client.authenticate();
    const api = Utils.dav3API(oauth_token);
    let workItemStatus = null;
    try {
        workItemStatus = await api.createWorkItem(workItemSpec);
    } catch (ex) {
        console.error(ex);
        const workitemStatus = {
            'Status': "Failed"
        };
        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
        return (res.status(500).json({
            diagnostic: 'Failed to execute workitem'
        }));
    }
    console.log('Submitted the workitem: ' + workItemStatus.id);
    workitemList.push({
        workitemId: workItemStatus.id
    })
    return (res.status(200).json({
        "workItemId": workItemStatus.id,
        "workItemStatus": workItemStatus.status,
        "ExtraInfo": null
    }));
});


///////////////////////////////////////////////////////////////////////
/// Handle the output json file generated by the workitem.
///////////////////////////////////////////////////////////////////////
router.put('/da4revit/file', jsonParser, async(req, res, next) =>{
    const workitem = workitemList.find( (item) => {
        return item.workitemId === req.body.Workitem;
    } )
    if( workitem === undefined ){
        console.log('The workitem: ' + req.body.id+ ' to callback is not in the item list');
        // response 200 to avoid calling again.
        return ( res.status(200).json({
            diagnostic: 'the workitem is not recogenized'
        }));
    }
    const workitemStatus = {
        'WorkitemId': req.body.Workitem,
        'Status': "Completed",
        'ExtraInfo' : req.body
    };
    global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);

    const index = workitemList.indexOf(workitem);
    workitemList.splice(index, 1);
    return (res.status(200).json({
        diagnostic: 'the workitem is well handled'
    }));
})


///////////////////////////////////////////////////////////////////////
/// 
///////////////////////////////////////////////////////////////////////
router.post('/callback/designautomation', async (req, res, next) => {
    // Best practice is to tell immediately that you got the call
    // so return the HTTP call and proceed with the business logic
    res.status(202).end();
    return;
})



module.exports = router;
