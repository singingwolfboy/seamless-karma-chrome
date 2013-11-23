// polyfills
if(!('contains' in String.prototype)) {
  String.prototype.contains = function(str, startIndex) { return -1 !== String.prototype.indexOf.call(this, str, startIndex); };
}

// use this extension's local storage to save Seamless information
var storage = chrome.storage.local;
/*
== SCHEMA ==
{
  "user": {
    "id": user ID on SeamlessKarma.com
    "seamless_id": user ID on Seamless.com
    "username": username on Seamless.com
    "allocation": daily allocation of lunch money
  },
  "organization": {
    "id": organization ID on SeamlessKarma.com
    "seamless_id": organization ID on Seamless.com
    "name": organization name
  },
  "sk_users": {
    // This is a mapping of full names to SeamlessKarma user IDs.
    // For example, it could contain entries like:
    "Alice Smith": 25,
    "Brian O'Malley": 82,
    "Chelsea Frink": 2,
    // and so on. Only users that share the same organization will
    // end up listed in here. This essentially functions as a local cache.
  },
  "sk_vendors": {
    // this is a similar mapping of vendor names to SeamlessKarma vendor IDs.
    "FuGaKyu": 37,
    "Tossed (Prudential Center)": 109,
  }

  // the below refer to the order currently in progress,
  // and will be cleared after each order is placed.

  "vendor": {
    "id": vendor ID on SeamlessKarma.com
    "seamless_id": vendor ID on Seamless.com
    "name": name of restaurant for this order
    "latitude": GPS coordinate
    "longitude": GPS coordinate
  },
  "order": {
    "seamless_id": the order ID on Seamless.com
    "for_date": the date that the order should be delivered
    "total": the total cost of the order
    "contributions": a list of 3-tuples, where each 3-tuple is
                   first_name, last_name, amount
  }
}
*/

var updateUsername = function() {
  storage.get("user", function(items) {
    user = items.user || {};
    var username = $("#username").val();
    if(user.username != username) {
      // clear out all data, stick in new username
      storage.set({"user": {"username": username}});
    }
  });
};

var setupLoginModal = function() {
  // the login modal is loaded via AJAX; when it's loaded, attach an
  // event to capture the username
  document.addEventListener("DOMSubtreeModified", function() {
    var form = $("form#loginForm");
    if(!form.length) { return; }
    $("#username").change(updateUsername);
    form.submit(captureUsername);
    $("h4.button a", form).click(updateUsername);
  });
};

var corporateLoginPage = function() {
  //$("#username").change(updateUsername);
  $("form#corporate_login").submit(updateUsername);
  $("form#corporate_login a.findfoodbutton").click(updateUsername);
};

var getInfoFromUserRow = function(row) {
  var full_name = $("td:first-child", row).text().trim();
  if(!full_name) { return false; }
  // split on &nbsp;
  var parts = full_name.split("\u00a0");
  var amount = $("input[type=text]", row).val();
  parts.push(amount);
  return parts;
};

var captureCurrentUserFullNameIfNeccessary = function() {
  storage.get("user", function(items) {
    var user = items.user;
    if(!user.first_name || !user.last_name) {
      var trashcans = $("table.userallocation tr.userrow td.delete");
      if (trashcans.length === 1) {
        var info = getInfoFromUserRow(trashcans.parent('tr'));
        user.first_name = info[0];
        user.last_name = info[1];
        user.allocation = user.allocation || info[2];
        storage.set({"user": user});
      }
    }
  });
};

var updateSKVendorsCache = function(callback) {
  storage.get(["sk_vendors"], function(items) {
    var jqXHRs = [], updated = false;
    items.sk_vendors = items.sk_vendors || {};
    $("ul.Restaurants li a").each(function() {
      var $a = $(this);
      var omo = $a.attr("onmouseover");
      // get the third parameter of the function call, which is in quotes
      var third_param = omo.match(/\w+\('\w+', +\w+, +'([^']+)'\);?/)[1];
      // third param is "name|description"
      var name = third_param.split("|")[0];
      // is this restaurant in our cache? If not, fetch or create it
      if(!(name in items.sk_vendors)) {
        jqXHRs.push($.ajax({
          url: "http://www.seamlesskarma.com/api/vendors",
          data: {"name": name},
          error: function(jqXHR) {
            console.error("Couldn't update SK user cache for "+name, jqXHR)
          },
          success: function(resp) {
            if (resp.count === 0) {
              // create it!
              $.ajax({
                url: "http://www.seamlesskarma.com/api/vendors",
                type: "POST",
                data: {
                  "name": name,
                  "seamless_id": $a.uri().query(true).vendorLocationId,
                },
                success: function(data) {
                  storage.get(["sk_vendors"], function(items) {
                    items.sk_vendors[name] = data.id;
                    storage.set(items);
                  })
                }
              })
            } else if (resp.count !== 1) {
              console.error("Wrong number of values for "+ name, resp);
              return;
            }
            var userdata = resp.data[0];
            items.sk_vendors[name] = userdata.id;
            updated = true;
          }
        }))
      }
    })
    if(!jqXHRs) {
      // nothing to update; return
      return callback && callback();
    }
    $.when.apply(this, jqXHRs).done(function() {
      if(!updated) {
        console.error("Unable to undate sk_vendors cache");
      }
      return storage.set({"sk_vendors": items.sk_vendors}, callback);
    });
  });
};

var weekdayMatch = {
  "Monday": 1,
  "Tuesday": 2,
  "Wednesday": 3,
  "Thursday": 4,
  "Friday": 5,
  "Saturday": 6,
  "Sunday": 7
}

var selectRestaurantPage = function() {
  updateSKVendorsCache();
  $("ul.Restaurants li a").click(function(){
    var $a = $(this);
    storage.get(["order", "sk_vendors"], function(items) {
      var name = $a.text();
      items.order = items.order || {};
      items.vendor = {
        "name": name,
        "seamless_id": $a.uri().query(true).vendorLocationId,
      };
      if(name in items.sk_vendors) {
        items.vendor.id = items.sk_vendors[name];
      }
      delete items.sk_vendors;
      var datestr = $a.parent().parent().prevAll('#opens').last().text();
      var date = moment();
      $.each(weekdayMatch, function(key, value) {
        if(datestr.contains(key)) {
          date = date.isoWeekday(value);
        }
      })
      items.order.for_date = date.format("YYYY-MM-DD");
      storage.set(items);
    })
  })
}

var checkoutPage = function() {
  captureCurrentUserFullNameIfNeccessary();

  var total = $("#allocationtable tr:last-child td:last-child").text().trim();
  if (total.charAt(0) === "$") {
    total = total.substr(1);
  }
  var order_id = $("#MyCurrentOrder table tr:first-child td:last-child").text().trim();

  var save_order = function() {
    // capture contributions
    var contributions = [];
    $("table.userallocation tr.userrow").each(function(){
      var info = getInfoFromUserRow(this);
      if(info) {
        contributions.push(info);
      }
    });
    storage.set({"order": {
      "seamless_id": order_id, // this is a string, not an int
      "total": total, // this is a string, not a decimal
      // contributions is a list of 3-tuples:
      // first name, last name, amount (as string)
      "contributions": contributions
    }});
  };

  $("form#pageForm").submit(save_order);
  $("form#pageForm a[name=submit_order]").click(save_order);
};

var getOrgName = function() {
  // must be logged in for this to work
  return $("h4#WelcomeBar p").text().split("-")[1].trim();
};

var getOrCreateSKUser = function(callback) {
  storage.get(["user"], function(items) {
    var user = items.user;
    if(user.id) {
      return callback && callback();
    }
    // no SK ID? Find it, or make it
    $.ajax({
      url: "http://www.seamlesskarma.com/api/users/" + user.username,
      type: "GET",
      success: function(data) {
        user.id = data.id;
        var name = data.first_name + " " + data.last_name;
        // do updates
        storage.get(["organization", "sk_users"], function(items) {
          items.organization.id = data.organization_id;
          items.sk_users[name] = data.id;
          items.user = user;
          storage.set(items, callback);
        });
      },
      error: function(jqXHR, textStatus, errorThrown) {
        if(jqXHR.status === 404) {
          // SK user doesn't exist, create it
          var user_info = URI("?"+$.cookie('user')).query(true);
          $.ajax({
            url: "http://www.seamlesskarma.com/api/users",
            type: "POST",
            data: {
              seamless_id: user_info.UserId,
              username: user.username || user_info.UserName,
              organization: getOrgName(),
              first_name: user.first_name,
              last_name: user.last_name,
              // no allocation: use org default
            },
            success: function(data) {
              user.id = data.id;
              var name = user.first_name + " " + user.last_name;
              storage.get(["sk_users"], function(items) {
                items.sk_users[name] = data.id;
                items.user = user;
                storage.set(items, callback);
              });
            },
            error: function() {
              console.error("cannot create SeamlessKarma user");
            }
          });
        } else {
          console.error("cannot retrieve SeamlessKarma user ID");
        }
      }
    });
  });
};

var updateSKUsersCache = function(callback) {
  storage.get(["order", "sk_users", "organization"], function(items) {
    var jqXHRs = [], updated = false;
    items.sk_users = items.sk_users || {};
    var org_id = items.organization.id;
    $.each(items.order.contributions, function(index, value) {
      // fetch user from local cache or from seamlesskarma
      var name = value[0] + " " + value[1];
      if(!(name in items.sk_users)) {
        var data = {
          "first_name": value[0],
          "last_name": value[1]
        };
        if(org_id) {
          data.organization_id = org_id;
        } else {
          console.warn("organization ID is not set");
        }
        jqXHRs.push($.ajax({
          url: "http://www.seamlesskarma.com/api/users",
          data: data,
          success: function(resp) {
            if (resp.count === 0) {
              var msg = 'No user with the name "'+name+'"';
              if(org_id) {
                msg += " in organization " + org_id;
              }
              msg += " exists on seamlesskarma.com";
              console.error(msg, resp);
            } else if (resp.count !== 1) {
              console.error('Too many users with the name "'+name+'"', resp);
            } else {
              items.sk_users[name] = resp.data[0].id;
              updated = true;
            }
          }
        }));
      }
    });
    if(!jqXHRs) {
      // nothing to update; return
      return callback && callback();
    }
    $.when.apply(this, jqXHRs).done(function() {
      if(!updated) {
        console.error("Unable to update sk_users cache");
      } else {
        return storage.set({"sk_users": items.sk_users}, callback);
      }
    });
  });
};

var sendOrderToSK = function(callback) {
  var vendor = {
    "name": $("input#vendorName").val(),
    "phone": $("input#phoneNumber").val(),
    "latitude": $("input#latitude").val(),
    "longitude": $("input#longitude").val()
  };
  var user_id = $("input#userId").val()
  storage.get(["user", "sk_users", "order", "vendor"], function(items) {
    var data = [
      {"name": "ordered_by_id", "value": items.user.id},
      {"name": "vendor_id", "value": items.vendor.id},
      {"name": "for_date", "value": items.order.for_date}
    ];
    $.each(items.order.contributions, function() {
      var name = this[0] + " " + this[1],
          amount = this[2];
      data.push({
        "name": "contributed_by",
        "value": items.sk_users[name]
      });
      data.push({
        "name": "contributed_amount",
        "value": amount
      });
    });
    $.ajax({
      url: "http://www.seamlesskarma.com/orders",
      type: "POST",
      data: $.param(data),
      success: function() {
        storage.remove(["order", "vendor"], callback);
      },
      error: function() {
        console.error("Unable to send order", data, arguments);
      }
    });
  });
};

var orderConfirmationPage = function() {
  getOrCreateSKUser(updateSKUsersCache(sendOrderToSK));
};

$(function() {
  if($("a#memberLogin").length) {
    setupLoginModal();
  }

  if ($("form#corporate_login").length) {
    corporateLoginPage();
  } else if ($("div.checkout .addnewuser").length) {
    checkoutPage();
  } else if ($("div#welcomenote h2:contains('invited to a Group Order')").length) {
    selectRestaurantPage();
  } else if ($("div.ThanksForOrder").length) {
    orderConfirmationPage();
  }

  // on order page, user id can be found using $("input#tagUserId").val()

  // debug only
  storage.get(null, function(items) {
    console.log("seamlesskarma storage:", items);
    // console.log(document.cookie); // "user" cookie has some good stuff
  });

});
