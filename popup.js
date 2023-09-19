$(document).ready(function() {
  UIController.initInputs();


  $('#gen-page').click(function() {
    UIController.saveInputs();
    UIController.disableInput();

    try {
      var sprintId = $('#sprint-id').val();

      if(inputValidator.isInvalidSprintId(sprintId)) {
        alert('Sprint id must be a number that does not start with 0');
        return;
      }

      sprintIssueService.getStatusEpicIssuesTable(sprintId,
        (sprintInfo, issuesTable) => sprintReportPageGenerator.generateByIssues(sprintInfo, issuesTable));
    } catch(e) {
      UIController.enableInput(e);
    }
  });
});

const UIController = (() => {
  return {
    initInputs: () => {
      chrome.storage.local.get(['sprintReportHelperConfig'], function(result) {
        const initialInputValues = JSON.parse(result.sprintReportHelperConfig);
        for(let [key, value] of Object.entries(initialInputValues)) {
          $(`#${key}`).val(value);
        }
      });
    },
    saveInputs: () => {
      let inputValueMap = {};
      $('input').each(function() {
        const elementId = $(this).attr('id');
        if(elementId == 'sprint-id') {
          return;
        }
        
        inputValueMap[elementId] = $(this).val();
      });

      chrome.storage.local.set({'sprintReportHelperConfig': JSON.stringify(inputValueMap)});
    },
    disableInput: () => {
      $('input').prop('readonly', true);
      $('#gen-page').prop('disabled', true);
      $('#msg').css('display', 'block');
      $('#msg').html('Creating...');
    },
    enableInput: (msg) => {
      $('input').prop('readonly', false);
      $('#gen-page').prop('disabled', false);

      if(msg) {
        $('#msg').html(msg);
      } else {
        $('#msg').css('display', 'none');
      }
    }
  }
})();

const inputValidator = (() => {
  return {
    isInvalidSprintId: sprintId => !/^[1-9]\d*$/.test(sprintId)
  }
})();

const sprintIssueService = (() => {
  function fetchSprintIssues(sprintInfo, callback) {
    $.ajax({
      url: `${$('#jira-domain').val()}/rest/api/2/search?jql=project=${$('#project-name').val()}%20AND%20Sprint=${sprintInfo.id}&fields=parent,status,summary,${$('#story-point-field').val()}`,
      type: 'GET',
      dataType: 'json',
      success: function(response) {
        try {
          let issuesTable = new StatusEpicIssuesTable();

          response.issues.forEach(issue => {
            if(isSubtask(issue)) {
              return;
            }


            const issueStatus = getIssueStatus(issue);
            const issueKey = getIssueKey(issue);
            const issueEpic = getIssueEpic(issue);
            const issueTitle = getIssueTitle(issue);

            issuesTable.getIssuesByStatusAndEpic(issueStatus, issueEpic)
              .push(new SprintIssue(issueKey, issueTitle));
          })

          callback(sprintInfo.name, issuesTable);
        } catch(e) {
          UIController.enableInput(e);
        }
      },
      error: function(xhr) {
        alert('Failed to find sprint issues');
        UIController.enableInput(xhr.responseJSON.message);
      }
    });
  }

  function isSubtask(issue) {
    return issue.fields.parent && issue.fields.parent.fields.issuetype.hierarchyLevel == 0;
  }

  function getIssueStatus(issue) {
    let status = issue.fields.status.name;
    if(status != 'In Progress' && status != 'Done') {
      status = 'Todo';
    }
    return status;
  }

  function getIssueKey(issue) {
    return issue.key.replace($('#project-name').val() + '-', '');
  }

  function getIssueEpic(issue) {
    const matches = issue.fields.summary.match(/^(?:\[(.+)\])?\s*.+/);
    if(matches) {
      return matches[1];
    } else {
      try {
        return issue.fields.parent.fields.summary;
      } catch(e) {
        return '?';
      }
    }
  }

  function getIssueTitle(issue) {
    const summary = issue.fields.summary;
    const matches = summary.match(/^(?:\[.+\])?\s*(.+)/);
    if(matches) {
      return matches[1];
    } else {
      return summary;
    }
  }

  return {
    getStatusEpicIssuesTable: (sprintId, callback) => {
      $.ajax({
        url: `${$('#jira-domain').val()}/rest/agile/1.0/sprint/${sprintId}`,
        type: 'GET',
        success: res => fetchSprintIssues(res, callback),
        error: (xhr) => {
          alert('Failed to find sprint, please check the sprint id inputted');
          UIController.enableInput(xhr.responseJSON.message);
        }
      });
    }
  }
})();

const sprintReportPageGenerator = (() => {
  // refer to: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
  function composeAtlasDocBody(issuesTable) {
    let atlasDoc = {
      "version": 1,
      "type": "doc",
      "content": []
    };


    for(let status of ['Todo', 'In Progress', 'Done', 'Demo']) {
      const section = composeContentSection(issuesTable, status);
      atlasDoc.content.push(...section);
    }

    return JSON.stringify(atlasDoc);
  }

  function composeContentSection(issuesTable, status) {
    const epicIssuesMap = issuesTable.getEpicIssueMapByStatus(status);

    let epicsPart = [];

    if(!epicIssuesMap || !epicIssuesMap.size) {
      epicsPart.push(composeEpicIssuesRow());
    } else {
      for(let [epic, issues] of epicIssuesMap) {
        epicsPart.push(composeEpicIssuesRow(epic, issues));
      }
    }

    let section = [
                    {
                      "type": "paragraph",
                      "content": [
                        {
                          "type": "text",
                          "text": "== "
                        },
                        {
                          "type": "text",
                          "text": status,
                          "marks": [
                            {
                              "type": "strong"
                            }
                          ]
                        },
                        {
                          "type": "text",
                          "text": " =="
                        }
                      ]
                    },
                    {
                      "type": "table",
                      "attrs": {
                        "isNumberColumnEnabled": false,
                        "layout": "layout"
                      },
                      "content": epicsPart
                    },
                    {
                      "type": "paragraph",
                      "content": [
                        {
                          "type": "text",
                          "text": " "
                        }
                      ]
                    }
                  ];

    return section;
  }

  function composeEpicIssuesRow(epic, issues) {
    let issuesPart = [];
    (issues || []).forEach(issue => {
      issuesPart.push({
                          "type": "paragraph",
                          "content": [
                            {
                              "type": "text",
                              "text": `${issue.id} - ${issue.title}`
                            }
                          ]
                        });
    });


    return {
              "type": "tableRow",
              "content": [
                composeEpicCell(epic),
                composeIssuesCell(issuesPart)
              ]
            };
  }

  function composeEpicCell(epic) {
    return {
            "type": "tableCell",
            "attrs": {
              "colWidth": [170]
            },
            "content": [
              {
                "type": "paragraph",
                "content": [
                  {
                    "type": "text",
                    "text": epic || ''
                  }
                ]
              }
            ]
          };
  }

  function composeIssuesCell(issuesPart) {
    return {
              "type": "tableCell",
              "attrs": {
                "colWidth": [510]
              },
              "content": issuesPart
            };
  }

  return {
    generateByIssues: (sprintName, issuesTable) => {
      $.ajax({
        url: `${$('#confluence-domain').val()}/rest/api/content`,
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
          "type": "page",
          "title": sprintName,
          "space": {
            "key": $('#space-key').val()
          },
          "ancestors": [
            {
              "id": $('#parent-page-id').val()
            }
          ],
          "body": {
            "atlas_doc_format": {
              "representation": "atlas_doc_format",
              "value": composeAtlasDocBody(issuesTable)
            }
          }
        }),
        success: function(data) {
          alert('Spring report page generated successfully!');
          UIController.enableInput(`Created:<br/>${data._links.base}${data._links.webui}`);
        },
        error: function(xhr) {
          alert('Failed to post page content');
          UIController.enableInput(xhr.responseJSON.message);
        }
      });
    }
  }
})();


class SprintIssue {
  constructor(id, title, epic) {
    this.id = id;
    this.title = title;
  }
}

class StatusEpicIssuesTable {
  constructor() {
    this.table = new Map();
  }

  getEpicIssueMapByStatus(status) {
    let map = this.table.get(status);
    if(! map) {
      map = new Map();
      this.table.set(status, map);
    }
    return map;
  }

  getIssuesByStatusAndEpic(status, epic) {
    let map = this.getEpicIssueMapByStatus(status);

    let arr = map.get(epic);
    if(! arr) {
      arr = [];
      map.set(epic, arr);
    }

    return arr;
  }
}